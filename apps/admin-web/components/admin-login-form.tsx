"use client";

import type { LoginResponse } from "@game-platform/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, apiRequest } from "../../web/lib/api-client";
import { useToast } from "../../web/components/toast-provider";

export function AdminLoginForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<LoginResponse>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
      if (result.account.type !== "ADMIN") {
        await apiRequest<void>("/api/v1/auth/logout", { method: "POST" });
        showToast("Player accounts must use the game website.", "error");
        return;
      }
      router.replace("/dashboard"); router.refresh();
    } catch (caught: unknown) { showToast(caught instanceof ApiClientError ? caught.message : "Unable to sign in", "error"); }
    finally { setPending(false); }
  }

  return <form className="mt-8 space-y-5" onSubmit={(event) => void submit(event)}><Field label="Username" name="username" autoComplete="username" /><Field label="Password" name="password" type="password" autoComplete="current-password" /><button className="w-full rounded-xl bg-lime-300 px-4 py-3 font-bold text-slate-950 transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-60" disabled={pending}>{pending ? "Signing in…" : "Sign in securely"}</button></form>;
}

function Field({ label, name, type = "text", autoComplete }: Readonly<{ label: string; name: string; type?: string; autoComplete: string }>) { return <label className="block text-sm font-semibold text-slate-300">{label}<input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-lime-300/60" name={name} type={type} autoComplete={autoComplete} required /></label>; }
