// pdf-helpers.ts
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { RenderParameters } from "pdfjs-dist/types/src/display/api";

// Configure PDF.js worker - use local worker file to avoid CORS issues
GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

// Configure PDF.js to use standard font data
// This helps resolve the font loading warnings
const STANDARD_FONT_DATA_URL =
  "https://unpkg.com/pdfjs-dist@4.0.269/standard_fonts/";

export async function pdfToImages(file: File, scale = 2): Promise<string[]> {
  try {
    const data = await file.arrayBuffer();

    // Configure PDF.js with standard font data
    const pdf = await getDocument({
      data,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      // Use worker but with proper configuration
      useWorkerFetch: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;

    const urls: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas context not available");

      // Set white background
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // v5: if using canvasContext, canvas MUST be null
      const params: RenderParameters = {
        canvas: null,
        canvasContext: ctx,
        viewport,
        background: "white",
        intent: "display",
      };

      const task = page.render(params);
      await task.promise;

      urls.push(canvas.toDataURL("image/jpeg", 0.92)); // or 'image/png'
    }
    return urls;
  } catch (error) {
    console.error("PDF processing error:", error);
    throw new Error(
      `Failed to process PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
