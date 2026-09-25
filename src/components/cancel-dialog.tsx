"use client";

import { useSession, signOut } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, ShieldCheck } from "lucide-react";

/**
 * Cancel auto-renewal: pauses the autopay mandate. Access continues till the
 * paid period ends; resubscribing re-arms the mandate.
 */
export function CancelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const expires = session?.user?.planExpiresAt ? new Date(session.user.planExpiresAt) : null;

  const cancel = async () => {
    try {
      const res = await fetch("/api/payments/cancel", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Could not cancel");
      await qc.invalidateQueries({ queryKey: ["session"] });
      toast({ title: "Auto-renewal cancelled", description: j.message });
      onOpenChange(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not cancel", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] border-zinc-800 bg-zinc-950 text-zinc-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg text-zinc-100">Cancel auto-renewal?</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            You keep full Pro access till the period you already paid for
            {expires ? ` — till ${expires.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` : ""}.
            No further debits happen after that unless you resubscribe.
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-2 space-y-2 text-xs">
          {[
            "Your autopay mandate is paused — no more auto-debits",
            "Pro features stay active till the paid period ends",
            "Resubscribe anytime — new validity stacks on top",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2 text-zinc-400">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-text" /> {t}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={cancel} className="h-10 w-full rounded-lg bg-loss text-sm font-semibold text-zinc-950 hover:bg-loss/90">
            Cancel auto-renewal
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9 w-full rounded-lg border-zinc-700 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Keep my subscription
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
