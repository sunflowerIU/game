"use client";

import type { PlatformStatusResponse } from "@game-platform/contracts";
import { useEffect, useState } from "react";

type ConnectionState =
  | { readonly kind: "checking" }
  | { readonly kind: "online"; readonly apiVersion: string }
  | { readonly kind: "offline" };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export function PlatformStatus() {
  const [connection, setConnection] = useState<ConnectionState>({ kind: "checking" });

  useEffect(() => {
    const controller = new AbortController();

    async function checkPlatform(): Promise<void> {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/platform/status`, {
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) throw new Error("Platform API is unavailable");

        const status = await response.json() as PlatformStatusResponse;
        if (status.status !== "ok" || status.service !== "game-platform-api") {
          throw new Error("Unexpected platform response");
        }

        setConnection({ kind: "online", apiVersion: status.apiVersion });
      } catch {
        if (!controller.signal.aborted) setConnection({ kind: "offline" });
      }
    }

    void checkPlatform();
    return () => controller.abort();
  }, []);

  const online = connection.kind === "online";
  const label = online
    ? `API v${connection.apiVersion} online`
    : connection.kind === "checking" ? "Checking API" : "API offline";

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300" role="status">
      <span className={`size-2 rounded-full ${online ? "bg-lime-300 shadow-[0_0_12px_rgba(190,242,100,0.8)]" : "bg-slate-600"}`} />
      {label}
    </div>
  );
}
