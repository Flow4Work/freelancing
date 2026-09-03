import type { Metadata } from "next";
import "./globals.css";
import "./fixup-finish.css";

export const metadata: Metadata = {
  title: "FixUp Scout",
  description: "Japanese creator discovery workspace for FixUp",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" style={{ scrollbarGutter: "stable" }}>
      <body>{children}</body>
    </html>
  );
}
