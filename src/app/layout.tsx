import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MEMEDESK — Autonomous Memecoin Terminal",
  description:
    "A multi-agent memecoin trading desk: discovery, rug defence, momentum, narrative, risk and execution, running as paper trades on live on-chain data.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
