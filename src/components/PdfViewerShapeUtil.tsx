import { useEffect, useMemo, useRef } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  useValue,
} from "tldraw";
import { createPortal } from "react-dom";
import type { RecordProps, TLBaseShape, TLShape } from "tldraw";

export type PdfViewerShape = TLBaseShape<
  "pdf-viewer",
  {
    w: number;
    h: number;
    contentW: number;
    contentH: number;
    pageUrls: string[];
    mode: "normal" | "min" | "max";
    header: boolean;
    savedFrame?: { x: number; y: number; w: number; h: number };
  }
>;

export class PdfViewerShapeUtil extends BaseBoxShapeUtil<PdfViewerShape> {
  static override type = "pdf-viewer" as const;

  static override props: RecordProps<PdfViewerShape> = {
    w: T.number,
    h: T.number,
    contentW: T.number,
    contentH: T.number,
    pageUrls: T.arrayOf(T.string),
    mode: T.literalEnum("normal", "min", "max"),
    header: T.boolean,
    savedFrame: T.object({
      x: T.number,
      y: T.number,
      w: T.number,
      h: T.number,
    }).optional(),
  };

  getDefaultProps(): PdfViewerShape["props"] {
    return {
      w: 640,
      h: 480,
      contentW: 640,
      contentH: 480,
      pageUrls: [],
      mode: "normal",
      header: true,
    };
  }

  // Make this shape behave like a container (similar to a frame)
  providesBackgroundForChildren(_shape: PdfViewerShape): boolean {
    return true;
  }

  canReceiveNewChildrenOfType(shape: TLShape) {
    return !shape.isLocked;
  }

  // When tools create shapes on top of us, ensure they become our children
  onDropShapesOver(shape: PdfViewerShape, shapes: TLShape[]) {
    const { editor } = this;
    const targets = shapes.filter((s) => this.canReceiveNewChildrenOfType(s));
    if (targets.length) editor.reparentShapes(targets, shape.id);
  }

  canResizeChildren(_shape: PdfViewerShape) {
    // Scale child annotations proportionally when resizing the viewer
    return true;
  }

  onDragShapesIn(
    shape: PdfViewerShape,
    draggingShapes: TLShape[],
    _info?: any
  ) {
    const { editor } = this;
    if (draggingShapes.every((s) => s.parentId === shape.id)) return;
    // Prevent parenting ancestors
    if (draggingShapes.some((s) => editor.hasAncestor(shape, s.id))) return;
    editor.reparentShapes(draggingShapes, shape.id);
  }

  onDragShapesOver(
    shape: PdfViewerShape,
    draggingShapes: TLShape[],
    _info?: any
  ) {
    const { editor } = this;
    if (draggingShapes.every((s) => s.parentId === shape.id)) return;
    if (draggingShapes.some((s) => editor.hasAncestor(shape, s.id))) return;
    editor.reparentShapes(draggingShapes, shape.id);
  }

  onDragShapesOut(
    shape: PdfViewerShape,
    draggingShapes: TLShape[],
    _info?: any
  ) {
    const { editor } = this;
    editor.reparentShapes(
      draggingShapes.filter((s) => s.parentId === shape.id),
      editor.getCurrentPageId()
    );
  }

  component(shape: PdfViewerShape) {
    return (
      <HTMLContainer
        id={shape.id}
        style={{
          background: "var(--color-background)",
          border: "1px solid var(--color-low-border)",
          borderRadius: 8,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <PdfViewerBody shape={shape} />
        <PdfToolbarOverlay shape={shape} />
      </HTMLContainer>
    );
  }

  indicator(shape: PdfViewerShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

function PdfViewerBody({ shape }: { shape: PdfViewerShape }) {
  const editor = useEditor();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevScrollTopRef = useRef<number>(0);

  // When drawing tools are active, disable pointer events so strokes land on the canvas
  const drawingTools = useMemo(
    () =>
      new Set(["draw", "text", "arrow", "erase", "highlighter", "scribble"]),
    []
  );
  const currentTool = editor.getCurrentToolId();
  const allowPointerEvents = !drawingTools.has(currentTool);

  // While we scale children, temporarily suppress scroll-sync to avoid double application
  const suppressScrollSyncRef = useRef<boolean>(false);
  (
    window as unknown as Record<string, unknown>
  ).__pdfViewerSuppressScrollSyncRef = suppressScrollSyncRef;

  // Keep content basis in sync with actual size when user resizes via handles
  useEffect(() => {
    if (shape.props.mode === "min") return;
    if (
      shape.props.contentW !== shape.props.w ||
      shape.props.contentH !== shape.props.h
    ) {
      editor.updateShape<PdfViewerShape>({
        id: shape.id,
        type: "pdf-viewer",
        props: {
          ...shape.props,
          contentW: shape.props.w,
          contentH: shape.props.h,
        },
      });
    }
  }, [shape.id, shape.props.w, shape.props.h, shape.props.mode, editor]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (suppressScrollSyncRef.current) return;
    const nextTop = el.scrollTop;
    const prevTop = prevScrollTopRef.current;
    const delta = nextTop - prevTop;
    if (delta === 0) return;
    prevScrollTopRef.current = nextTop;

    // Move child annotations to keep them visually attached to the scrolled content
    const childIds = editor.getSortedChildIdsForParent(shape.id);
    if (!childIds.length) return;
    const updates = childIds
      .map((id) => editor.getShape(id))
      .filter(Boolean)
      .map((child) => ({
        id: child!.id,
        type: child!.type,
        y: child!.y - delta,
      }));
    if (updates.length) editor.updateShapes(updates as any);
  };

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          pointerEvents: allowPointerEvents ? "auto" : "none",
          background: "var(--color-background)",
        }}
      >
        {shape.props.pageUrls.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 8,
            }}
          >
            {shape.props.pageUrls.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`PDF page ${i + 1}`}
                style={{
                  width: "100%",
                  height: "auto",
                  display: "block",
                  border: "1px solid var(--color-low-border)",
                  borderRadius: 4,
                  background: "white",
                }}
                draggable={false}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        color: "var(--color-text-3)",
        fontSize: 12,
      }}
    >
      No pages yet. Use "Load PDF" to add page images.
    </div>
  );
}

function PdfToolbarOverlay({ shape }: { shape: PdfViewerShape }) {
  const editor = useEditor();
  useValue("shape props", () => shape.props, [shape.id]);

  const el = document.body as HTMLElement | null;
  if (!el || !shape.props.header) return null;

  useValue("camera", () => editor.getCamera(), []);
  const screen = editor.pageToScreen({ x: shape.x, y: shape.y });
  const right = editor.pageToScreen({ x: shape.x + shape.props.w, y: shape.y });
  const overlayWidth = Math.max(120, right.x - screen.x);

  const dragInfoRef = useRef<{
    id: number;
    startPageX: number;
    startPageY: number;
    startShapeX: number;
    startShapeY: number;
  } | null>(null);

  const onOverlayPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.target !== e.currentTarget) return;
    const start = editor.screenToPage({ x: e.clientX, y: e.clientY });
    dragInfoRef.current = {
      id: e.pointerId,
      startPageX: start.x,
      startPageY: start.y,
      startShapeX: shape.x,
      startShapeY: shape.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onOverlayPointerMove = (e: React.PointerEvent) => {
    if (!dragInfoRef.current) return;
    const curr = editor.screenToPage({ x: e.clientX, y: e.clientY });
    const { startPageX, startPageY, startShapeX, startShapeY } =
      dragInfoRef.current;
    const dx = curr.x - startPageX;
    const dy = curr.y - startPageY;
    editor.updateShape<PdfViewerShape>({
      id: shape.id,
      type: "pdf-viewer",
      x: startShapeX + dx,
      y: startShapeY + dy,
      props: { ...shape.props },
    });
  };

  const onOverlayPointerUp = (e: React.PointerEvent) => {
    if (!dragInfoRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(
        dragInfoRef.current.id
      );
    } catch {}
    dragInfoRef.current = null;
  };

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: screen.x,
        top: screen.y - 48,
        display: "flex",
        gap: 12,
        padding: "8px 12px",
        borderRadius: 8,
        background: "#f5f5f5",
        border: "1px solid var(--color-low-border)",
        boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
        zIndex: 1000,
        pointerEvents: "auto",
        cursor: dragInfoRef.current ? "grabbing" : "grab",
        width: overlayWidth,
        boxSizing: "border-box",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      onPointerDown={onOverlayPointerDown}
      onPointerMove={onOverlayPointerMove}
      onPointerUp={onOverlayPointerUp}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>
          PDF Viewer
        </span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {shape.props.mode !== "max" ? (
          <button
            style={{ fontSize: 14, padding: "2px 6px", cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              editor.select(shape.id);
              maximizeVia(editor, shape);
            }}
            title="Maximize"
          >
            ⤢
          </button>
        ) : (
          <button
            style={{ fontSize: 14, padding: "2px 6px", cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              editor.select(shape.id);
              restoreVia(editor, shape);
            }}
            title="Restore"
          >
            ⤡
          </button>
        )}
        {shape.props.mode !== "min" && (
          <button
            style={{ fontSize: 14, padding: "2px 6px", cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              editor.select(shape.id);
              minimizeVia(editor, shape);
            }}
            title="Minimize"
          >
            ▁
          </button>
        )}
        <button
          style={{ fontSize: 14, padding: "2px 6px", cursor: "pointer" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            closeVia(editor, shape);
          }}
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>,
    el
  );
}

function maximizeVia(
  editor: ReturnType<typeof useEditor>,
  shape: PdfViewerShape
) {
  reparentContainedShapes(editor, shape);
  const vp = editor.getViewportPageBounds?.();
  if (!vp) return;
  const next = {
    x: vp.x + 16,
    y: vp.y + 16,
    w: Math.max(200, vp.w - 32),
    h: Math.max(150, vp.h - 32),
    mode: "max" as const,
    savedFrame: { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h },
  };
  const childIds = editor.getSortedChildIdsForParent(shape.id);
  const scaleX = next.w / shape.props.contentW;
  const scaleY = next.h / shape.props.contentH;
  const scaleOrigin = { x: shape.x, y: shape.y };
  const suppressRef = (
    window as unknown as {
      __pdfViewerSuppressScrollSyncRef?: React.MutableRefObject<boolean>;
    }
  ).__pdfViewerSuppressScrollSyncRef;
  editor.run(() => {
    if (suppressRef) suppressRef.current = true;
    for (const cid of childIds) {
      const c = editor.getShape(cid);
      if (!c) continue;
      const bounds = editor.getShapeGeometry(c).bounds;
      editor.resizeShape(
        c.id,
        { x: scaleX, y: scaleY },
        { initialBounds: bounds, scaleOrigin, isAspectRatioLocked: false }
      );
    }
    editor.updateShape<PdfViewerShape>({
      id: shape.id,
      type: "pdf-viewer",
      x: next.x,
      y: next.y,
      props: {
        ...shape.props,
        w: next.w,
        h: next.h,
        contentW: next.w,
        contentH: next.h,
        mode: next.mode,
        savedFrame: next.savedFrame,
      },
    });
    if (suppressRef) suppressRef.current = false;
  });
}

function restoreVia(
  editor: ReturnType<typeof useEditor>,
  shape: PdfViewerShape
) {
  reparentContainedShapes(editor, shape);
  const f = shape.props.savedFrame;
  const next = {
    x: f?.x ?? shape.x,
    y: f?.y ?? shape.y,
    w: f?.w ?? shape.props.w,
    h: f?.h ?? shape.props.h,
    mode: "normal" as const,
  };
  const childIds = editor.getSortedChildIdsForParent(shape.id);
  const scaleX = next.w / shape.props.contentW;
  const scaleY = next.h / shape.props.contentH;
  const scaleOrigin = { x: shape.x, y: shape.y };
  const suppressRef = (
    window as unknown as {
      __pdfViewerSuppressScrollSyncRef?: React.MutableRefObject<boolean>;
    }
  ).__pdfViewerSuppressScrollSyncRef;
  editor.run(() => {
    if (suppressRef) suppressRef.current = true;
    for (const cid of childIds) {
      const c = editor.getShape(cid);
      if (!c) continue;
      const bounds = editor.getShapeGeometry(c).bounds;
      editor.resizeShape(
        c.id,
        { x: scaleX, y: scaleY },
        { initialBounds: bounds, scaleOrigin, isAspectRatioLocked: false }
      );
    }
    editor.updateShape<PdfViewerShape>({
      id: shape.id,
      type: "pdf-viewer",
      x: next.x,
      y: next.y,
      props: {
        ...shape.props,
        w: next.w,
        h: next.h,
        contentW: next.w,
        contentH: next.h,
        mode: next.mode,
        savedFrame: undefined,
      },
    });
    if (suppressRef) suppressRef.current = false;
  });
}

function minimizeVia(
  editor: ReturnType<typeof useEditor>,
  shape: PdfViewerShape
) {
  const savedFrame = shape.props.savedFrame ?? {
    x: shape.x,
    y: shape.y,
    w: shape.props.w,
    h: shape.props.h,
  };
  editor.updateShape<PdfViewerShape>({
    id: shape.id,
    type: "pdf-viewer",
    props: { ...shape.props, mode: "min", savedFrame, h: 32 },
  });
}

function closeVia(editor: ReturnType<typeof useEditor>, shape: PdfViewerShape) {
  const childIds = editor.getSortedChildIdsForParent(shape.id);
  if (childIds.length) {
    const children = childIds
      .map((id) => editor.getShape(id))
      .filter(Boolean) as TLShape[];
    if (children.length)
      editor.reparentShapes(children, editor.getCurrentPageId());
  }
  editor.deleteShape(shape.id);
}

function reparentContainedShapes(
  editor: ReturnType<typeof useEditor>,
  shape: PdfViewerShape
) {
  const pageId = editor.getCurrentPageId();
  const viewerBounds =
    shape.props.mode === "min" && shape.props.savedFrame
      ? {
          x: shape.props.savedFrame.x,
          y: shape.props.savedFrame.y,
          w: shape.props.savedFrame.w,
          h: shape.props.savedFrame.h,
        }
      : { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h };

  const topLevelIds = editor.getSortedChildIdsForParent(pageId);
  const toReparent: TLShape[] = [];
  for (const id of topLevelIds) {
    if (id === shape.id) continue;
    const s = editor.getShape(id);
    if (!s) continue;
    if (s.parentId !== pageId) continue;
    if ((s as any).type === "pdf-viewer") continue;
    const b = editor.getShapePageBounds(id);
    if (!b) continue;
    const intersects = !(
      b.maxX < viewerBounds.x ||
      b.minX > viewerBounds.x + viewerBounds.w ||
      b.maxY < viewerBounds.y ||
      b.minY > viewerBounds.y + viewerBounds.h
    );
    if (intersects) {
      toReparent.push(s);
    }
  }
  if (toReparent.length) editor.reparentShapes(toReparent, shape.id);
}
