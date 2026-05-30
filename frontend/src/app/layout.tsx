import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aegis — AI Infrastructure Guardian",
  description:
    "Self-healing DevOps infrastructure platform powered by local AI inference. Real-time container monitoring, crash analysis, and autonomous remediation.",
  keywords: [
    "DevOps",
    "AI",
    "Infrastructure",
    "Docker",
    "Self-Healing",
    "Monitoring",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col overflow-hidden">
        {/* Background gradient mesh */}
        <div className="bg-mesh" />
        <div className="grid-bg fixed inset-0 z-0 pointer-events-none" />
        {children}
      </body>
    </html>
  );
}
