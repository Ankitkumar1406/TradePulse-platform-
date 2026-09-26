"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { BadgePercent, CheckCircle2, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { CYCLES, PRO_PLANS, formatINR, type Cycle } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * Upgrade / manage Pro plan. All four cycles (monthly, 3-month, 6-month,
 * annual) are recurring subscriptions via UPI Autopay / card mandate —
 * cancel anytime. Demo checkout simulates the mandate authorization.
 *
 * IMPORTANT trial framing: the 15-day trial is genuinely card-free — no
 * mandate is created at sign-up and nothing auto-charges when it ends.
 * This dialog is the ONLY place payment details are ever asked for.
 */
export function UpgradeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [phase, setPhase] = useState<"idle" | "creating" | "checkout" | "verifying">("idle");
  const [demoOrder, setDemoOrder] = useState<{ orderId: string; amount: number; per: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = PRO_PLANS[cycle];
  const isPro = Boolean(session?.user?.isPro);
  const proSource = session?.user?.proSource;
  const autoRenew = session?.user?.autoRenew ?? true;
  const onTrial = isPro && proSource === "trial";

  useEffect(() => {
    if (open) {
      setPhase("idle");
      setDemoOrder(null);
      setError(null);
    }
  }, [open]);

  const startCheckout = async () => {
    setError(null);
    setPhase("creating");
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle }),
      });
      const j = (await res.json()) as {
        mode?: string; orderId?: string; amount?: number; error?: string; sessionId?: string;
      };
      if (!res.ok) throw new Error(j.error ?? "Could not start checkout");
      if (j.mode === "cashfree" && j.sessionId) {
        // Real Cashfree drop-in mounts here; hosted fallback below.
        window.location.href = `https://payments.cashfree.com/session/${j.sessionId}`;
        return;
      }
      setDemoOrder({ orderId: j.orderId ?? "", amount: (j.amount ?? plan.price * 100) / 100, per: plan.per });
      setPhase("checkout");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setPhase("idle");
    }
  };

  const confirmDemo = async (outcome: "success" | "failure") => {
    if (!demoOrder) return;
    setPhase("verifying");
    try {
      const res = await fetch("/api/payments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: demoOrder.orderId, outcome }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; expiresAt?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Payment failed");
      await qc.invalidateQueries({ queryKey: ["session"] });
      toast({
        title: "Pro activated",
        description: `Subscription active till ${j.expiresAt ? new Date(j.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "the paid period"} — auto-renews, cancel anytime.`,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
      setPhase("checkout");
    } finally {
      setPhase("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-h-[92vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-200 sm:max-w-lg">
        {phase === "checkout" && demoOrder ? (
          <div>
            <DialogHeader>
              <DialogTitle className="text-lg text-zinc-100">Confirm your subscription</DialogTitle>
              <DialogDescription className="text-xs">
                Demo mode — Cashfree credentials are not configured on this server. The UPI Autopay / card mandate debit
                is simulated.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 rounded-2xl border border-gold/30 bg-gold/8 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">TradePulse Pro · {demoOrder.per}</span>
                <span className="font-bold text-zinc-50">{formatINR(demoOrder.amount)}</span>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-gold-text">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formatINR(demoOrder.amount)} auto-debits every {demoOrder.per}. Cancel anytime — no charges after
                cancellation, access continues till the period you paid for.
              </p>
            </div>
            <div className="mt-4 space-y-2">
              <Button
                onClick={() => confirmDemo("success")}
                className="h-10 w-full rounded-lg bg-brand text-sm font-semibold text-white hover:bg-brand-hover"
              >
                Pay {formatINR(demoOrder.amount)} (simulate success)
              </Button>
              <Button
                variant="outline"
                onClick={() => confirmDemo("failure")}
                className="h-9 w-full rounded-lg border-zinc-700 bg-transparent text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Simulate failed payment
              </Button>
              <p className="pt-1 text-center text-[10px] leading-4 text-zinc-600">
                Demo mode — add CASHFREE_APP_ID and CASHFREE_SECRET_KEY to switch to the real Cashfree checkout.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <DialogHeader>
              <DialogTitle className="text-lg text-zinc-100">
                {isPro ? "Manage your Pro plan" : "Upgrade to TradePulse Pro"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {isPro
                  ? autoRenew === false
                    ? "Your subscription ends at the paid period — pick a cycle to re-arm autopay. New validity stacks on top."
                    : "Extend your Pro subscription — new validity stacks on top of what's left."
                  : onTrial
                    ? "Your 15-day trial required no card and nothing auto-charges when it ends — subscribing is entirely your call. This is the only step where payment details (UPI Autopay / card mandate) are ever asked."
                    : "Recurring Pro subscription via UPI Autopay or card mandate — set up only now, at your explicit action. Renews automatically, cancel anytime."}
              </DialogDescription>
            </DialogHeader>

            {/* Cycle selector */}
            <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Billing cycle">
              {CYCLES.map((c) => {
                const p = PRO_PLANS[c.id];
                const active = cycle === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCycle(c.id)}
                    aria-pressed={active}
                    className={cn(
                      "relative rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active ? "border-brand/60 bg-brand/10" : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600"
                    )}
                  >
                    <span className={cn("block text-xs font-semibold", active ? "text-brand-text" : "text-zinc-300")}>
                      {c.label}
                    </span>
                    <span className="mt-0.5 block text-sm font-bold text-zinc-100">{formatINR(p.price)}</span>
                    {c.note && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[9px] font-semibold text-gold-text">
                        {c.note}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Price summary */}
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Pro · {plan.per}</span>
                <span className="font-bold text-zinc-50">
                  {formatINR(plan.price)} <span className="text-xs font-normal text-zinc-500">/ {plan.per}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-zinc-500 line-through">{formatINR(plan.was)}</span>
                <span className="flex items-center gap-1 font-medium text-gold-text">
                  <BadgePercent className="h-3 w-3" />
                  Save {plan.savePct}% · introductory offer
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-500">{plan.effective} · {plan.billed}</p>
            </div>

            {/* features */}
            <ul className="mt-3 space-y-1.5 text-xs">
              {[
                "All 39 scanners across 8 categories — incl. Trader Choice templates",
                "Charts view with timeframe, EMA, base overlay & RS filters",
                "Sector rotation quadrant, sector strength & momentum",
                "Trading journal & market calendar",
                "Unlimited watchlists & smart price alerts",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-zinc-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-text" /> {f}
                </li>
              ))}
            </ul>

            {error && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs leading-5 text-loss">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <Button
              type="button"
              onClick={startCheckout}
              disabled={phase !== "idle"}
              className="mt-4 h-11 w-full rounded-full bg-brand text-sm font-semibold text-white shadow-lg shadow-brand/25 hover:bg-brand-hover disabled:opacity-60"
            >
              {phase !== "idle" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {phase === "creating" ? "Preparing checkout…" : phase === "verifying" ? "Setting up autopay…" : "Waiting…"}
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Subscribe · {formatINR(plan.price)}/{plan.per}
                </>
              )}
            </Button>
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500">
              <RefreshCw className="h-3 w-3 text-brand-text" />
              Auto-renews via UPI Autopay / card mandate · cancel anytime, access till period end
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
