import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Post Creator — Social content from your memory",
  description: "Generate weekly themes, posts, reels, articles, carousels & quotes with Claude + Gemini.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
