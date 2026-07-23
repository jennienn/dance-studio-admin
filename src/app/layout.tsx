// src/app/layout.tsx
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata = {
  title: "Élanor Dance Academy",
  description: "댄스학원 회원 및 수강 관리 시스템"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${GeistSans.className} ${GeistSans.variable}`}>{children}</body>
    </html>
  );
}
