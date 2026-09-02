import { AdminLoginForm } from "../components/admin-login-form";

export default function AdminLoginPage() {
  return <main className="grid min-h-screen place-items-center px-5 py-12"><section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0d131e]/95 p-8 shadow-2xl shadow-black/40"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-lime-300 font-black text-slate-950">GP</span><div><p className="font-black text-white">GameOps</p><p className="text-xs uppercase tracking-[0.18em] text-slate-500">Private administration</p></div></div><h1 className="mt-8 text-4xl font-black tracking-[-0.04em] text-white">Administrator sign in</h1><p className="mt-3 text-sm leading-6 text-slate-400">This private surface is restricted to authorized platform operators.</p><AdminLoginForm /></section></main>;
}
