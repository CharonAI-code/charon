import type { Metadata } from "next";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Charon — Policy before execution",
  description:
    "Pre-execution policy enforcement for autonomous agents. Every action gated, inspected, and receipted before it touches your machine.",
  openGraph: {
    title: "Charon — Policy before execution",
    description:
      "Pre-execution policy enforcement for autonomous agents. Every action gated, inspected, and receipted.",
    siteName: "Charon",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Charon — Policy before execution",
    description:
      "Pre-execution policy enforcement for autonomous agents.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
