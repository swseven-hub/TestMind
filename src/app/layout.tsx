import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TestMind",
  description: "AI 测试用例生成工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
