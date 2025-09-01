import React, { useRef, useState, useEffect } from "react";
import { createTLStore, Tldraw, Editor, createShapeId } from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import { pdfToImages } from "../utils/pdf-helpers";
import type { TLParentId } from "@tldraw/tldraw";

// ✅ helper to fake asset IDs
const createAssetId = (id: string) => `asset:${id}`;

const PdfEditorPage: React.FC = () => {
  const editorRef = useRef<Editor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pageGroups, setPageGroups] = useState<
    { id: string; y: number; h: number }[]
  >([]);

  const store = React.useMemo(() => createTLStore({}), []);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please upload a PDF file");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const pageUrls = await pdfToImages(file, 2);
      if (!editorRef.current) return;

      let yOffset = 0;
      const gap = 50;
      const groups: { id: string; y: number; h: number }[] = [];

      for (let i = 0; i < pageUrls.length; i++) {
        const url = pageUrls[i];
        const img = new Image();
        img.src = url;

        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            const groupId = createShapeId();
            const imageId = createShapeId();
            const assetId = createAssetId(`pdf-${i}`);

            editorRef.current?.createAssets([
              {
                id: assetId as any,
                type: "image",
                typeName: "asset",
                props: {
                  name: `PDF Page ${i + 1}`,
                  src: url,
                  w: img.width,
                  h: img.height,
                  mimeType: "image/png",
                  isAnimated: false,
                },
                meta: {},
              },
            ]);

            // ✅ Group acts like container (draggable & resizable)
            editorRef.current?.createShape({
              id: groupId,
              type: "group",
              x: 0,
              y: yOffset,
              isLocked: false,
            });

            // ✅ Image inside group
            editorRef.current?.createShape({
              id: imageId,
              type: "image",
              parentId: groupId,
              x: 0,
              y: 0,
              props: {
                w: img.width,
                h: img.height,
                assetId: assetId as any,
              },
            });

            editorRef.current?.updateShape({
              id: groupId,
              type: "group",
              props: {},
              meta: {},
            });

            groups.push({ id: groupId, y: yOffset, h: img.height });
            yOffset += img.height + gap;
            resolve();
          };

          img.onerror = reject;
        });
      }

      setPageGroups(groups);
    } catch (err) {
      console.error("PDF load error:", err);
      setError("Failed to load PDF");
    } finally {
      setIsProcessing(false);
      if (e.target) e.target.value = "";
    }
  };

  // 👇 Auto-stick annotations into the correct PDF group
  useEffect(() => {
    if (!editorRef.current) return;

    const handleShapeCreate = (shape: any) => {
      if (shape.type === "group" || shape.type === "image") return;

      const page = pageGroups.find(
        (p) => shape.y >= p.y && shape.y <= p.y + p.h
      );

      if (page) {
        editorRef.current?.updateShape({
          id: shape.id,
          type: shape.type,
          parentId: page.id as TLParentId,
          isLocked: true,
        });
      }
    };

    editorRef.current.on("create-shape" as any, handleShapeCreate);
    return () => {
      editorRef.current?.off("create-shape" as any, handleShapeCreate);
    };
  }, [pageGroups]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div
        style={{
          padding: "10px",
          background: "#f5f5f5",
          borderBottom: "1px solid #ddd",
          display: "flex",
          gap: "10px",
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          {isProcessing ? "Loading..." : "Upload PDF"}
        </button>
      </div>

      {error && <div style={{ padding: "10px", color: "red" }}>{error}</div>}

      {/* ✅ Scrollable container for Tldraw */}
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "auto", // 👈 scrolling enabled
          background: "#fafafa",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "2000px", // 👈 gives vertical scroll space (auto expands with pages)
            position: "relative",
          }}
        >
          <Tldraw
            store={store}
            onMount={(editor: Editor) => {
              editorRef.current = editor;
            }}
          />
        </div>
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
