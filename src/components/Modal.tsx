// src/components/Modal.tsx
"use client";

export function Modal({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          borderRadius: 12,
          padding: 22,
          width: 360,
          maxWidth: "100%",
          maxHeight: "85vh",
          overflowY: "auto"
        }}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
