"use client";

import { useRef, useState, type ReactNode } from "react";

export default function ResizableReport({
  preview,
  conversation,
  open,
}: {
  preview: ReactNode;
  conversation: ReactNode;
  open: boolean;
}) {
  const [width, setWidth] = useState(360);
  const container = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.max(280, Math.min(720, value));
  return (
    <div ref={container} className="flex min-h-0 flex-1">
      <div className={open ? "hidden min-h-0 min-w-0 flex-1 flex-col lg:flex" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
        {preview}
      </div>
      {open && (
        <>
          <div
            role="separator"
            aria-label="调整报告对话宽度"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuemin={280}
            aria-valuemax={720}
            aria-valuenow={width}
            className="hidden w-2 shrink-0 cursor-col-resize touch-none bg-border hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none lg:block"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setWidth(clamp(width + (event.key === "ArrowLeft" ? 24 : -24)));
              }
            }}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId) && container.current) {
                const rect = container.current.getBoundingClientRect();
                setWidth(clamp(Math.min(rect.width - 320, rect.right - event.clientX)));
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
          <div style={{ width }} className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col lg:flex-none">
            {conversation}
          </div>
        </>
      )}
    </div>
  );
}
