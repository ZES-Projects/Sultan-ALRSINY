import React, { useRef, useState, useEffect, useCallback } from "react";
import { createTLStore, Tldraw, Editor, createShapeId } from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { pdfToImages } from "../utils/pdf-helpers";
import type { TLParentId, TLShapeId } from "@tldraw/tldraw";
import { PDFDocument } from "pdf-lib";

// ---------- Helpers ----------
const createAssetId = (id: string) => `asset:${id}`;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function pagePointToViewport(editor: Editor, x: number, y: number) {
  const anyEditor = editor as any;
  if (typeof anyEditor.pageToViewport === "function") {
    return anyEditor.pageToViewport({ x, y });
  }
  if (typeof anyEditor.pageToScreen === "function") {
    return anyEditor.pageToScreen({ x, y });
  }
  return { x, y };
}

// ---------- Component ----------
const PdfEditorPage: React.FC = () => {
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track page groups to re-parent annotations & export
  const [pageGroups, setPageGroups] = useState<
    { id: TLShapeId; y: number; w: number; h: number; url: string }[]
  >([]);

  // “Viewer” (frame) and internal content group IDs
  const frameIdRef = useRef<TLShapeId | null>(null);
  const contentGroupIdRef = useRef<TLShapeId | null>(null);

  // Viewer geometry in page-space
  const [viewerSize, setViewerSize] = useState<{ w: number; h: number } | null>(
    null
  );
  const [contentHeight, setContentHeight] = useState<number>(0);
  const [scroll, setScroll] = useState<number>(0);

  // Viewer window controls (HTML toolbar)
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const prevSizeRef = useRef<{ w: number; h: number } | null>(null);

  // HTML overlay scrollbar
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(
    null
  );
  const [toolbarStyle, setToolbarStyle] = useState<React.CSSProperties | null>(
    null
  );

  // For smooth “stickiness”: only update overlay style if bounds actually changed
  const lastOverlayRectRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const store = React.useMemo(() => createTLStore({}), []);

  const resetViewer = useCallback(() => {
    frameIdRef.current = null;
    contentGroupIdRef.current = null;
    setPageGroups([]);
    setContentHeight(0);
    setViewerSize(null);
    setScroll(0);
    setIsMinimized(false);
    setOverlayStyle(null);
    setToolbarStyle(null);
    lastOverlayRectRef.current = null;
  }, []);

  const setFrameSize = useCallback((w: number, h: number) => {
    const editor = editorRef.current;
    const frameId = frameIdRef.current;
    if (!editor || !frameId) return;
    const frame = editor.getShape(frameId) as any;
    if (!frame) return;
    editor.updateShape({
      id: frameId,
      type: "frame",
      props: {
        ...(frame.props || {}),
        w,
        h,
        name: frame.props?.name || "PDF Viewer",
      },
    });
    setViewerSize({ w, h });
  }, []);

  // ---------- Upload & Place PDF ----------
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please upload a PDF file");
      if (e.target) e.target.value = "";
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const pageUrls = await pdfToImages(file, 2);
      const editor = editorRef.current;
      if (!editor) return;

      // Clean previous viewer if any
      if (frameIdRef.current) {
        try {
          editor.deleteShapes([frameIdRef.current]);
        } catch {
          /* ignore */
        }
      }
      resetViewer();

      // Base viewer size off first page
      const firstImg = await loadImage(pageUrls[0]);
      const frameW = Math.min(1000, firstImg.width);
      const frameH = Math.min(
        720,
        Math.max(520, Math.floor(firstImg.height * 0.85))
      );

      // Create frame (the clipped window)
      const frameId = createShapeId() as TLShapeId;
      editor.createShape({
        id: frameId,
        type: "frame",
        x: 80,
        y: 80,
        props: { w: frameW, h: frameH, name: "PDF Viewer" },
      });

      // Create content group inside the frame (we move this for scrolling)
      const contentGroupId = createShapeId() as TLShapeId;
      editor.createShape({
        id: contentGroupId,
        type: "group",
        parentId: frameId as TLParentId,
        x: 0,
        y: 0,
        isLocked: false,
      });

      frameIdRef.current = frameId;
      contentGroupIdRef.current = contentGroupId;
      setViewerSize({ w: frameW, h: frameH });

      // Add pages: fit width to frame; height scales proportionally
      let yOffset = 0;
      const gap = 24;
      const groups: {
        id: TLShapeId;
        y: number;
        w: number;
        h: number;
        url: string;
      }[] = [];

      for (let i = 0; i < pageUrls.length; i++) {
        const url = pageUrls[i];
        const img = await loadImage(url);

        const pageW = frameW;
        const pageH = Math.round((img.height / img.width) * pageW);

        const assetId = createAssetId(`pdf-${i}`);
        const pageGroupId = createShapeId() as TLShapeId;
        const imageId = createShapeId() as TLShapeId;

        // Register asset
        editor.createAssets([
          {
            id: assetId as any,
            type: "image",
            typeName: "asset",
            props: {
              name: `PDF Page ${i + 1}`,
              src: url,
              w: pageW,
              h: pageH,
              mimeType: "image/jpeg",
              isAnimated: false,
            },
            meta: {},
          },
        ]);

        // Per-page group
        editor.createShape({
          id: pageGroupId,
          type: "group",
          parentId: contentGroupId as TLParentId,
          x: 0,
          y: yOffset,
          isLocked: false,
        });

        // Scaled image in page group
        editor.createShape({
          id: imageId,
          type: "image",
          parentId: pageGroupId as TLParentId,
          x: 0,
          y: 0,
          props: {
            w: pageW,
            h: pageH,
            assetId: assetId as any,
          },
        });

        groups.push({ id: pageGroupId, y: yOffset, w: pageW, h: pageH, url });
        yOffset += pageH + gap;
      }

      setPageGroups(groups);
      setContentHeight(Math.max(0, yOffset - gap));
      setScroll(0);

      // Ensure content is at top
      editor.updateShape({
        id: contentGroupId,
        type: "group",
        x: 0,
        y: 0,
      });

      // Position the overlay on next frame
      requestAnimationFrame(() => updateOverlayFromFrame(true));
    } catch (err) {
      console.error("PDF load error:", err);
      setError("Failed to load PDF");
    } finally {
      setIsProcessing(false);
      if (e.target) e.target.value = "";
    }
  };

  // ---------- Scrolling ----------
  const applyScroll = useCallback(
    (next: number) => {
      const editor = editorRef.current;
      const contentGroupId = contentGroupIdRef.current;
      if (!editor || !contentGroupId || !viewerSize) return;

      const maxScroll = Math.max(0, contentHeight - viewerSize.h);
      const clamped = Math.max(0, Math.min(maxScroll, next));
      setScroll(clamped);

      editor.updateShape({
        id: contentGroupId,
        type: "group",
        x: 0,
        y: -clamped, // move up as we scroll down
      });
    },
    [contentHeight, viewerSize]
  );

  const onHtmlScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    applyScroll(el.scrollTop);
  }, [applyScroll]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - scroll) > 1) {
      el.scrollTop = scroll;
    }
  }, [scroll]);

  // ---------- Overlay alignment (with sticky RAF loop) ----------
  const updateOverlayFromFrame = useCallback((force = false) => {
    const editor = editorRef.current;
    const frameId = frameIdRef.current;
    if (!editor || !frameId) {
      // frame missing: clear overlay
      if (overlayStyle) setOverlayStyle(null);
      if (toolbarStyle) setToolbarStyle(null);
      return;
    }

    const b = editor.getShapePageBounds(frameId);
    if (!b) {
      // bounds missing: clear overlay
      if (overlayStyle) setOverlayStyle(null);
      return;
    }

    const tl = pagePointToViewport(editor, b.x, b.y);
    const br = pagePointToViewport(editor, b.x + b.w, b.y + b.h);

    const left = Math.min(tl.x, br.x);
    const top = Math.min(tl.y, br.y);
    const width = Math.abs(br.x - tl.x);
    const height = Math.abs(br.y - tl.y);

    const prev = lastOverlayRectRef.current;
    const changed =
      !prev ||
      Math.abs(prev.left - left) > 0.5 ||
      Math.abs(prev.top - top) > 0.5 ||
      Math.abs(prev.width - width) > 0.5 ||
      Math.abs(prev.height - height) > 0.5;

    if (changed || force) {
      lastOverlayRectRef.current = { left, top, width, height };
      setOverlayStyle({
        position: "absolute",
        left,
        top,
        width,
        height,
        pointerEvents: "none", // clicks pass through EXCEPT inner scroller
        zIndex: 5,
      });
      // Toolbar aligned to the top of the frame
      setToolbarStyle({
        position: "absolute",
        left,
        top: top - 70,
        width,
        height: 32,
        display: "flex",
        alignItems: "center",
        paddingLeft: 8,
        gap: 8,
        pointerEvents: "auto",
        zIndex: 6,
      });
    }
  }, []);

  // Keep overlay aligned using a store listener (covers shape/camera changes)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const dispose =
      (editor.store as any).listen?.(
        () => {
          updateOverlayFromFrame();
        },
        { scope: "all" }
      ) ??
      (() => {
        const id = window.setInterval(() => updateOverlayFromFrame(), 200);
        return () => window.clearInterval(id);
      });

    // Initial
    updateOverlayFromFrame(true);

    return () => {
      try {
        dispose && dispose();
      } catch {
        /* ignore */
      }
    };
  }, [updateOverlayFromFrame]);

  // 🔥 NEW: Sticky RAF loop so the overlay tracks *during* drags/resizes smoothly
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      updateOverlayFromFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [updateOverlayFromFrame]);

  // ---------- Auto-parent annotations to the correct page (robust, pens/brushes supported) ----------
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const isAnnotation = (type: string) =>
      type !== "group" && type !== "image" && type !== "frame";

    const stickById = (shapeId: TLShapeId) => {
      const contentGroupId = contentGroupIdRef.current;
      const frameId = frameIdRef.current;
      if (!contentGroupId || !frameId) return;

      const shape = editor.getShape(shapeId) as any;
      if (!shape || !isAnnotation(shape.type)) return;

      const frameBounds = editor.getShapePageBounds(frameId);
      const shapeBounds = editor.getShapePageBounds(shapeId);
      if (!frameBounds || !shapeBounds) return;

      const frameTopWorldY = frameBounds.y;
      const yMid = shapeBounds.y + shapeBounds.h / 2;
      const contentSpaceY = yMid - frameTopWorldY + scroll;

      const page = pageGroups.find(
        (p) => contentSpaceY >= p.y && contentSpaceY <= p.y + p.h
      );
      const targetParent = (page?.id ?? contentGroupId) as TLParentId;

      if ((shape as any).parentId !== targetParent) {
        (editor as any).reparentShapes?.([shapeId], targetParent);
        editor.updateShape({ id: shapeId, type: shape.type, isLocked: false });
      }
    };

    // Stick on create
    const offAfterCreate =
      (editor as any).sideEffects?.registerAfterCreateHandler?.(
        "shape",
        (record: any) => {
          if (isAnnotation(record.type)) stickById(record.id as TLShapeId);
        }
      ) ?? (() => {});

    // Stick on change (covers brush/pen live updates & drags)
    const offAfterChange =
      (editor as any).sideEffects?.registerAfterChangeHandler?.(
        "shape",
        (_before: any, after: any) => {
          if (isAnnotation(after.type)) stickById(after.id as TLShapeId);
        }
      ) ?? (() => {});

    // If frame or content group is deleted externally, reset overlay and state
    const offAfterDelete =
      (editor as any).sideEffects?.registerAfterDeleteHandler?.(
        "shape",
        (record: any) => {
          const frameId = frameIdRef.current;
          const contentGroupId = contentGroupIdRef.current;
          if (record?.id === frameId || record?.id === contentGroupId) {
            resetViewer();
          }
        }
      ) ?? (() => {});

    return () => {
      try {
        typeof offAfterCreate === "function" && offAfterCreate();
        typeof offAfterChange === "function" && offAfterChange();
        typeof offAfterDelete === "function" && offAfterDelete();
      } catch {
        /* ignore */
      }
    };
  }, [pageGroups, scroll, resetViewer]);

  // ---------- Render ----------
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: "10px",
          background: "#f5f5f5",
          borderBottom: "1px solid #ddd",
          display: "flex",
          gap: "10px",
          alignItems: "center",
          zIndex: 6,
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          {isProcessing ? "Loading..." : "Upload PDF"}
        </button>

        {/* Export PDF */}
        {pageGroups.length > 0 && (
          <button
            onClick={async () => {
              try {
                const editor = editorRef.current;
                const contentGroupId = contentGroupIdRef.current;
                if (!editor || !contentGroupId) return;

                const pdfDoc = await PDFDocument.create();

                for (const page of pageGroups) {
                  // Create a page in PDF with same pixel size
                  const pdfPage = pdfDoc.addPage([page.w, page.h]);

                  // Embed the original rendered page image
                  const imgBytes = await (await fetch(page.url)).arrayBuffer();
                  const jpg = await pdfDoc.embedJpg(imgBytes);
                  pdfPage.drawImage(jpg, {
                    x: 0,
                    y: 0,
                    width: page.w,
                    height: page.h,
                  });

                  // Collect annotation shapes under this page group
                  const childIds = (editor as any).getSortedChildIdsForParent(
                    page.id
                  ) as TLShapeId[];
                  const shapes = childIds
                    .map((id) => editor.getShape(id))
                    .filter(Boolean) as any[];

                  const annotationIds = shapes
                    .filter((s) => s.type !== "image")
                    .map((s) => s.id as TLShapeId);

                  if (annotationIds.length > 0) {
                    const pageBounds = editor.getShapePageBounds(page.id);
                    const svgResult = await editor.getSvgString(annotationIds, {
                      background: false,
                      padding: 0,
                      preserveAspectRatio: "xMidYMid meet",
                      pixelRatio: 1,
                      // Ensure the exported SVG uses the page's absolute bounds
                      bounds: pageBounds || undefined,
                    } as any);

                    if (svgResult?.svg) {
                      const svgUrl = `data:image/svg+xml;utf8,${encodeURIComponent(
                        svgResult.svg
                      )}`;
                      const svgImg = await new Promise<HTMLImageElement>(
                        (resolve, reject) => {
                          const img = new Image();
                          img.onload = () => resolve(img);
                          img.onerror = reject;
                          img.src = svgUrl;
                        }
                      );

                      // Draw SVG onto a canvas to get a bitmap for pdf-lib
                      const canvas = document.createElement("canvas");
                      canvas.width = Math.ceil(page.w);
                      canvas.height = Math.ceil(page.h);
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(
                          svgImg,
                          0,
                          0,
                          canvas.width,
                          canvas.height
                        );
                        const pngDataUrl = canvas.toDataURL("image/png");
                        const pngBytes = await (
                          await fetch(pngDataUrl)
                        ).arrayBuffer();
                        const png = await pdfDoc.embedPng(pngBytes);
                        pdfPage.drawImage(png, {
                          x: 0,
                          y: 0,
                          width: page.w,
                          height: page.h,
                        });
                      }
                    }
                  }
                }

                const bytes = await pdfDoc.save();
                const blob = new Blob([bytes], { type: "application/pdf" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "annotated.pdf";
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                console.error("Export PDF failed", err);
                setError("Failed to export PDF");
              }
            }}
            disabled={isProcessing}
          >
            Export PDF
          </button>
        )}

        {viewerSize && contentHeight > viewerSize.h && (
          <span style={{ marginLeft: 8, color: "#666" }}>
            {Math.round(scroll)} / {Math.max(0, contentHeight - viewerSize.h)}
          </span>
        )}
      </div>

      {error && <div style={{ padding: "10px", color: "red" }}>{error}</div>}

      {/* Canvas */}
      <div style={{ position: "relative", flex: 1 }}>
        <Tldraw
          store={store}
          onMount={(editor: Editor) => {
            editorRef.current = editor;
            setTimeout(() => updateOverlayFromFrame(true), 50);
          }}
        />

        {/* HTML Toolbar Overlay - aligned with frame top */}
        {toolbarStyle && viewerSize && pageGroups.length > 0 && (
          <div style={toolbarStyle}>
            <div
              style={{
                height: 32,
                width: "100%",
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,

                padding: "0 8px",
              }}
            >
              <button
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 14,
                  background: "#f4c542",
                  border: "none",
                  cursor: "pointer",
                }}
                title="Minimize"
                onClick={() => {
                  if (!viewerSize) return;
                  if (!isMinimized) {
                    prevSizeRef.current = viewerSize;
                    setFrameSize(viewerSize.w, 48);
                    setIsMinimized(true);
                    // maximize removed
                  } else {
                    const prev = prevSizeRef.current || { w: 800, h: 600 };
                    setFrameSize(prev.w, prev.h);
                    setIsMinimized(false);
                  }
                }}
              />
              {/* Maximize removed by request */}
              <button
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 14,
                  background: "#f44336",
                  border: "none",
                  cursor: "pointer",
                }}
                title="Close"
                onClick={() => {
                  const editor = editorRef.current;
                  const frameId = frameIdRef.current;
                  if (!editor || !frameId) return;
                  try {
                    editor.deleteShapes([frameId]);
                  } catch {}
                  resetViewer();
                }}
              />
            </div>
          </div>
        )}

        {/* HTML Scrollbar Overlay - only render when a viewer exists */}
        {overlayStyle && viewerSize && pageGroups.length > 0 && (
          <div style={overlayStyle}>
            <div
              ref={scrollerRef}
              onScroll={onHtmlScroll}
              style={{
                pointerEvents: "auto",
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 16,
                overflowY: "auto",
                overflowX: "hidden",
                background: "transparent",
                zIndex: 6,
              }}
            >
              <div style={{ width: 1, height: contentHeight }} />
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={handlePdfUpload}
      />
    </div>
  );
};

export default PdfEditorPage;
