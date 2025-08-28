import React, { useState, useRef, useCallback } from "react";
import { createShapeId } from "@tldraw/tldraw";
import { pdfToImages } from "../utils/pdf-helpers";
import CustomTldraw from "./CustomTldraw";
import { useStableTldrawSync } from "../utils/stableTldrawSync";
import { getDefaultUserPresence } from "@tldraw/tldraw";

const PdfTestPage: React.FC = () => {
  const [isPdfProcessing, setIsPdfProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfFileInputRef] = useState<React.RefObject<HTMLInputElement>>(
    useRef(null)
  );
  const editorRef = useRef<any>(null);

  // Set up tldraw sync for testing
  const { store: syncStore } = useStableTldrawSync({
    roomId: "pdf-test-room",
    userInfo: {
      id: "test-user",
      name: "Test User",
      color: "#FF6B6B",
    },
    getUserPresence: (store: any, user: any) => {
      const defaultPresence = getDefaultUserPresence(store, user);
      if (!defaultPresence) return null;
      return {
        ...defaultPresence,
        cursor: defaultPresence.cursor || {
          x: 0,
          y: 0,
          type: "default",
          rotation: 0,
        },
      };
    },
  });

  const handlePdfUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !editorRef.current) return;

      // Validate file type
      if (file.type !== "application/pdf") {
        setError("Please select a PDF file");
        return;
      }

      setIsPdfProcessing(true);
      setError(null);

      try {
        const pageUrls = await pdfToImages(file, 2); // scale 2 for clarity

        // Preload images to get intrinsic sizes
        const metas = await Promise.all(
          pageUrls.map(
            (url) =>
              new Promise<{ url: string; width: number; height: number }>(
                (resolve, reject) => {
                  const img = new Image();
                  img.onload = () =>
                    resolve({
                      url,
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                  img.onerror = (e) => reject(e);
                  img.src = url;
                }
              )
          )
        );

        const maxW = Math.max(...metas.map((m) => m.width));
        const maxH = Math.max(...metas.map((m) => m.height));

        // Create a frame sized to fit all pages with offsets
        const frameId = createShapeId();
        const offsetStep = 20;
        const padding = 40;
        editorRef.current.createShape({
          id: frameId,
          type: "frame",
          x: 200,
          y: 150,
          props: {
            name: `PDF Document (${pageUrls.length} pages)`,
            w: maxW + offsetStep * (metas.length - 1) + padding,
            h: maxH + offsetStep * (metas.length - 1) + padding,
          },
        });

        // Add each page as an image shape inside the frame, at full size
        for (let index = 0; index < metas.length; index++) {
          try {
            const { url: pageUrl, width: iw, height: ih } = metas[index];
            const imageId = createShapeId();

            // Store the image data in the editor's asset system
            editorRef.current.store.put([
              {
                id: `asset:pdf-page-${index}`,
                typeName: "asset",
                type: "image",
                props: {
                  name: `Page ${index + 1}`,
                  src: pageUrl,
                  w: iw,
                  h: ih,
                  mimeType: "image/jpeg",
                  isAnimated: false,
                },
                meta: {},
              },
            ]);

            // Create the image shape with the asset reference at full size
            editorRef.current.createShape({
              id: imageId,
              type: "image",
              x: 220 + index * offsetStep,
              y: 170 + index * offsetStep,
              props: {
                w: iw,
                h: ih,
                assetId: `asset:pdf-page-${index}`,
              },
              parentId: frameId,
            });
          } catch (error) {
            console.error(`Error creating image for page ${index + 1}:`, error);
          }
        }

        editorRef.current.select(frameId);

        console.log("PDF loaded successfully with", pageUrls.length, "pages");
      } catch (err) {
        console.error("PDF render failed:", err);
        setError("Failed to render PDF. Please try again.");
      } finally {
        setIsPdfProcessing(false);
        // Clear the input
        if (event.target) {
          event.target.value = "";
        }
      }
    },
    []
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div
        style={{
          padding: "20px",
          backgroundColor: "#f5f5f5",
          borderBottom: "1px solid #ddd",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1>PDF Upload Test Page</h1>
        <button
          onClick={() => pdfFileInputRef.current?.click()}
          disabled={isPdfProcessing}
          style={{
            padding: "10px 20px",
            backgroundColor: isPdfProcessing ? "#ccc" : "#007bff",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: isPdfProcessing ? "not-allowed" : "pointer",
            fontSize: "16px",
          }}
        >
          {isPdfProcessing ? "Processing..." : "Upload PDF"}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "10px",
            backgroundColor: "#f8d7da",
            color: "#721c24",
            border: "1px solid #f5c6cb",
            margin: "10px",
            borderRadius: "5px",
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Whiteboard */}
      <div style={{ flex: 1, position: "relative" }}>
        <CustomTldraw
          store={syncStore}
          autoFocus
          inferDarkMode
          onMount={(editor: any) => {
            editorRef.current = editor;
            editor.setCurrentTool("select");
          }}
        />
      </div>

      {/* Hidden file input */}
      <input
        ref={pdfFileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handlePdfUpload}
        style={{ display: "none" }}
      />
    </div>
  );
};

export default PdfTestPage;
