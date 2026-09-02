import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "../components/toast-provider";

import "./globals.css";

const playerOrigin = process.env.NEXT_PUBLIC_PLAYER_ORIGIN ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(playerOrigin),
  title: "GameVerse Mobile Arcade",
  description: "Sign in and play live mobile games.",
  applicationName: "GameVerse",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GameVerse"
  },
  openGraph: {
    title: "GAMEVERSE",
    description: "Live mobile arcade",
    images: [{ url: "/og.png", width: 1792, height: 1024, alt: "GAMEVERSE live mobile arcade" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "GAMEVERSE",
    description: "Live mobile arcade",
    images: ["/og.png"]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#06031a"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
