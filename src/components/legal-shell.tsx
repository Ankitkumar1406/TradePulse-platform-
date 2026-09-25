import Link from "next/link";
import { Activity } from "lucide-react";
import { COMPANY } from "@/lib/company";

/**
 * Shared shell for the standalone legal pages (/terms, /privacy,
 * /refund-policy). Server component — no client JS needed.
 */

export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2" aria-label="TradePulse home">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand shadow-md shadow-brand/25">
              <Activity className="h-4 w-4 text-white" />
            </span>
            <span className="text-sm font-bold tracking-tight text-zinc-50">
              Trade<span className="text-brand-text">Pulse</span>
            </span>
          </Link>
          <Link
            href="/"
            className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-50">{title}</h1>
        <p className="mt-2 text-xs text-zinc-500">Last updated: {updated}</p>
        <div className="mt-10 space-y-10">{children}</div>
      </main>

      <footer className="border-t border-zinc-800/70 py-8 text-center text-[11px] leading-5 text-zinc-600">
        <div className="mx-auto max-w-4xl px-4">
          <p>
            {COMPANY.legalName} · {COMPANY.registeredAddress}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3">
            <Link href="/terms" className="transition-colors hover:text-zinc-400">Terms of Service</Link>
            <span aria-hidden="true">·</span>
            <Link href="/privacy" className="transition-colors hover:text-zinc-400">Privacy Policy</Link>
            <span aria-hidden="true">·</span>
            <Link href="/refund-policy" className="transition-colors hover:text-zinc-400">Refund &amp; Cancellation</Link>
          </p>
          <p className="mt-3">
            Nothing on TradePulse is investment advice — do your own research or consult a SEBI-registered investment
            adviser. © 2026 {COMPANY.legalName}.
          </p>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-zinc-100">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-zinc-400">{children}</div>
    </section>
  );
}
