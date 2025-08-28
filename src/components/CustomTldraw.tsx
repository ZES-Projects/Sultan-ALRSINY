import React, { useEffect, useRef } from "react";
import { Tldraw, TldrawProps } from "@tldraw/tldraw";
import { RemoteTLStoreWithStatus } from "@tldraw/sync";
import "tldraw/tldraw.css";

interface CustomTldrawProps extends Omit<TldrawProps, "store"> {
  className?: string;
  store: RemoteTLStoreWithStatus | null;
}

const CustomTldraw: React.FC<CustomTldrawProps> = ({
  className,
  store,
  ...props
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Remove watermark elements after component mounts
    const removeWatermark = () => {
      if (containerRef.current) {
        // Remove watermark elements by various selectors
        const watermarkSelectors = [
          '[data-testid="watermark"]',
          '[class*="watermark"]',
          '[class*="Watermark"]',
          '[class*="tldraw-watermark"]',
          '[class*="made-with"]',
          '[class*="MadeWith"]',
          '[class*="tldraw-logo"]',
          '[class*="TldrawLogo"]',
          // Common watermark patterns
          'div[style*="position: fixed"][style*="bottom"]',
          'div[style*="position: absolute"][style*="bottom"]',
          // Look for elements containing "tldraw" text
          'div:contains("tldraw")',
          'div:contains("TLDRAW")',
          'div:contains("Made with")',
          'div:contains("MADE WITH")',
        ];

        watermarkSelectors.forEach((selector) => {
          try {
            const elements = containerRef.current?.querySelectorAll(selector);
            elements?.forEach((el) => {
              (el as HTMLElement).style.display = "none";
            });
          } catch (e) {
            // Ignore invalid selectors
          }
        });

        // Also look for elements by text content
        const walker = document.createTreeWalker(
          containerRef.current,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent?.toLowerCase();
          if (text && (text.includes("tldraw") || text.includes("made with"))) {
            const parent = node.parentElement;
            if (parent && parent.style) {
              parent.style.display = "none";
            }
          }
        }
      }
    };

    // Remove watermark immediately
    removeWatermark();

    // Also remove watermark after a short delay to catch dynamically added elements
    const timeoutId = setTimeout(removeWatermark, 100);
    const intervalId = setInterval(removeWatermark, 1000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, []);

  // Handle null store
  if (!store) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <div>Initializing whiteboard...</div>
      </div>
    );
  }

  // Handle different store states
  if (store.status === "loading") {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <div>Connecting to whiteboard...</div>
      </div>
    );
  }

  if (store.status === "error") {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <div>
          Error connecting to whiteboard:{" "}
          {store.error?.message || "Unknown error"}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <style>
        {`
          /* Hide watermark elements */
          [data-testid="watermark"],
          [class*="watermark"],
          [class*="Watermark"],
          [class*="tldraw-watermark"],
          [class*="made-with"],
          [class*="MadeWith"],
          [class*="tldraw-logo"],
          [class*="TldrawLogo"],
          div[style*="position: fixed"][style*="bottom"],
          div[style*="position: absolute"][style*="bottom"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          
          /* Hide any element containing tldraw text */
          div:contains("tldraw"),
          div:contains("TLDRAW"),
          div:contains("Made with"),
          div:contains("MADE WITH") {
            display: none !important;
          }
        `}
      </style>
      <Tldraw store={store.store} {...props} />
    </div>
  );
};

export default CustomTldraw;
