import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TradePulse — End-of-day research & scanners for every NSE stock",
  description:
    "All 3,551 NSE-listed stocks. 39 one-click scanners incl. Trader Choice templates with RS, EPS score & A/D ratings, market breadth, sector rotation & momentum, a professional trading journal and the market calendar — built for working professionals and students who research after the close.",
  keywords: ["NSE", "stock screener", "end of day", "scanners", "market breadth", "trading journal"],
  authors: [{ name: "TradePulse" }],
  openGraph: {
    title: "TradePulse",
    description: "Research after the market closes. Execute with clarity when it opens.",
    siteName: "TradePulse",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-200 min-h-screen flex flex-col`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
