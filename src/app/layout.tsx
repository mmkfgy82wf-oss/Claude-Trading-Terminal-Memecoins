import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

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
    <html lang="de" className={jetbrains.variable}>
      <body>{children}</body>
    </html>
  );
}
