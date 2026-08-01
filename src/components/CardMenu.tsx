// src/components/CardMenu.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export function CardMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="수강 관리 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        className="secondary"
        style={{ width: "auto", padding: "2px 8px", fontSize: 16, lineHeight: 1 }}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            overflow: "hidden",
            zIndex: 10,
            minWidth: 130
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                color: item.danger ? "var(--danger)" : "var(--text)",
                border: "none",
                borderRadius: 0,
                padding: "9px 14px",
                fontSize: 13,
                fontWeight: 500
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
