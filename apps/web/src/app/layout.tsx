import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "./nav";

export const metadata = {
  title: "agentic-news · 千人千面的 AI 资讯",
  description: "支持个性化的多租户资讯平台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Nav />
        <main>{children}</main>
      </body>
    </html>
  );
}
