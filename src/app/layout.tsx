// src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "댄스학원 관리 시스템",
  description: "운영자 전용 관리 시스템"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
