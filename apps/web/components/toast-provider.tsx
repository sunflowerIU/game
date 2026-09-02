"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ToastTone = "error" | "success" | "info";
interface ToastItem { id: number; message: string; tone: ToastTone }
interface ToastContextValue { showToast: (message: string, tone?: ToastTone) => void }

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    timers.current.set(id, window.setTimeout(() => dismiss(id), tone === "error" ? 6500 : 4500));
  }, [dismiss]);

  useEffect(() => () => { for (const timer of timers.current.values()) window.clearTimeout(timer); }, []);

  return <ToastContext.Provider value={{ showToast }}>{children}<div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3" aria-label="Notifications" aria-live="polite">{toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismiss} />)}</div></ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

function Toast({ toast, onDismiss }: Readonly<{ toast: ToastItem; onDismiss: (id: number) => void }>) {
  const style = toast.tone === "error" ? "border-red-300/25 bg-[#251417] text-red-100" : toast.tone === "success" ? "border-lime-300/25 bg-[#152116] text-lime-100" : "border-sky-300/25 bg-[#101d28] text-sky-100";
  const marker = toast.tone === "error" ? "!" : toast.tone === "success" ? "✓" : "i";
  return <div className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-2xl shadow-black/40 backdrop-blur ${style}`} role={toast.tone === "error" ? "alert" : "status"}><span className="grid size-6 shrink-0 place-items-center rounded-full border border-current/20 text-xs font-black">{marker}</span><p className="min-w-0 flex-1 text-sm leading-6">{toast.message}</p><button className="grid size-6 shrink-0 place-items-center rounded-md text-lg opacity-60 transition hover:bg-white/5 hover:opacity-100" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>×</button></div>;
}
