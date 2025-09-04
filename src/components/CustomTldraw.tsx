import React, { useEffect, useRef } from "react";
import { Tldraw, TldrawProps, TLStore } from "@tldraw/tldraw";
import { RemoteTLStoreWithStatus } from "@tldraw/sync";
import "tldraw/tldraw.css";

// Updated props interface to handle both TLStore and RemoteTLStoreWithStatus
interface CustomTldrawProps extends Omit<TldrawProps, "store"> {
  className?: string;
  store: TLStore | RemoteTLStoreWithStatus | null;
}

const CustomTldraw: React.FC<CustomTldrawProps> = ({
  className,
  store,
  ...props
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const removeWatermark = () => {
      if (containerRef.current) {
        const watermarkSelectors = [
          '[data-testid="watermark"]',
          '[class*="watermark"]',
          '[class*="Watermark"]',
          '[class*="tldraw-watermark"]',
          '[class*="made-with"]',
          '[class*="MadeWith"]',
          '[class*="tldraw-logo"]',
          '[class*="TldrawLogo"]',
          'div[style*="position: fixed"][style*="bottom"]',
          'div[style*="position: absolute"][style*="bottom"]',
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

    removeWatermark();
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

  // Handle different store states if it's RemoteTLStoreWithStatus
  if ("status" in store && store.status === "loading") {
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

  if ("status" in store && store.status === "error") {
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
      className={`${className || ""} custom-tldraw-container`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <style>
        {`
          .custom-tldraw-container [data-testid="watermark"],
          .custom-tldraw-container [class*="watermark"],
          .custom-tldraw-container [class*="Watermark"],
          .custom-tldraw-container [class*="tldraw-watermark"],
          .custom-tldraw-container [class*="made-with"],
          .custom-tldraw-container [class*="MadeWith"],
          .custom-tldraw-container [class*="tldraw-logo"],
          .custom-tldraw-container [class*="TldrawLogo"],
          .custom-tldraw-container div[style*="position: fixed"][style*="bottom"],
          .custom-tldraw-container div[style*="position: absolute"][style*="bottom"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          .custom-tldraw-container div:contains("tldraw"),
          .custom-tldraw-container div:contains("TLDRAW"),
          .custom-tldraw-container div:contains("Made with"),
          .custom-tldraw-container div:contains("MADE WITH") {
            display: none !important;
          }
        `}
      </style>
      <Tldraw store={store} {...props} />
    </div>
  );
};

export default CustomTldraw;
