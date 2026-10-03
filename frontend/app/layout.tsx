import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BootSplash } from "@/components/BootSplash";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

// Fonts are system font stacks (declared in globals.css as CSS variables) rather
// than next/font/google. That keeps `npm run dev` / `npm run build` fully
// offline-capable — no dependency on fonts.googleapis.com at build time, which
// matters on flaky hackathon wifi. The stacks are chosen to closely match the
// original Newsreader / Inter / JetBrains Mono look and feel.

export const metadata: Metadata = {
  title: "PulseID — Lifelong medical records, anchored to National ID",
  description:
    "A national digital healthcare platform. Every citizen's medical history, linked to their National ID, accessible instantly by doctors and safely by patients.",
  manifest: "/site.webmanifest",
  applicationName: "PulseID",
  appleWebApp: { title: "PulseID", statusBarStyle: "default", capable: true },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E7C7B",
  // viewport-fit=cover lets full-bleed screens (splash, emergency scan,
  // camera scanner) draw edge-to-edge under a phone's notch/status bar,
  // using the safe-area-inset-* CSS env() vars to keep content clear of it.
  // maximumScale is capped just above 1 (not locked to exactly 1) so the
  // double-tap-to-zoom gesture that makes a page feel "web, not app" is
  // gone, while pinch-zoom still works for anyone who needs it for
  // accessibility — userScalable is deliberately left enabled.
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body bg-paper text-ink antialiased">
        <OfflineBanner />
        <BootSplash />
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
