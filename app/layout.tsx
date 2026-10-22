import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Formlabs Dashboard Status",
  description: "Unofficial uptime monitor for Formlabs Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
