import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "../../web/components/toast-provider";
import "./globals.css";

export const metadata: Metadata = { title: "GameOps Private Administration", description: "Private game platform operations" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><ToastProvider>{children}</ToastProvider></body></html>;
}
