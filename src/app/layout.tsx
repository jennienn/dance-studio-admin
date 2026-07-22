// src/app/layout.tsx
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata = {
  title: "Élanor Dance Academy",
  description: "댄스학원 회원 및 수강 관리 시스템"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${GeistSans.className} ${GeistSans.variable} ${GeistMono.variable}`}>{children}</body>
    </html>
  );
}
