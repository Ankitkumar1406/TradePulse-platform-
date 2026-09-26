"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { nameIssue, phoneIssue } from "@/lib/validation";
import { signOutToLanding } from "@/lib/logout";

const EXPERIENCE = [
  { id: "beginner", label: "Beginner", hint: "New to markets or < 1 year" },
  { id: "intermediate", label: "Intermediate", hint: "1-5 years, know the basics" },
  { id: "advanced", label: "Advanced", hint: "5+ years or full-time" },
];

const INTERESTS = [
  "Swing trading", "Positional investing", "Breakouts", "Multi-timeframe RSI",
  "Market breadth", "Sector rotation", "Candlestick patterns", "Earnings setups",
];

/**
 * Mandatory first-time onboarding. Name and phone are required (they were
 * captured at signup — prefilled here so users can review/fix in one place).
 */
export function ProfileSetup() {
  const qc = useQueryClient();
  const { data } = useQuery<{ name: string | null; phone: string | null; city: string | null; experience: string | null; interests: string | null }>({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("profile failed");
      return res.json();
    },
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [experience, setExperience] = useState("beginner");
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (data.name) setName(data.name);
    if (data.phone) {
      const digits = data.phone.replace(/\D/g, "").slice(-10);
      setPhone(digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : data.phone);
    }
    if (data.city) setCity(data.city);
    if (data.experience) setExperience(data.experience);
    if (data.interests) setInterests(data.interests.split(",").filter(Boolean));
  }, [data]);

  const issues = useMemo(() => ({ name: nameIssue(name), phone: phoneIssue(phone) }), [name, phone]);
  const canSubmit = !issues.name && !issues.phone && !busy;

  const submit = async () => {
    setTouched(true);
    if (issues.name || issues.phone) return;
    setBusy(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, city, experience, interests }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: j.error ?? "Could not save profile", variant: "destructive" });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["session"] });
      // refresh the session so onboarded=true flows through
      await fetch("/api/auth/session", { cache: "no-store" });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand shadow-md shadow-brand/25">
            <Activity className="h-4 w-4 text-white" />
          </span>
          <span className="text-sm font-bold text-zinc-50">Trade<span className="text-brand-text">Pulse</span></span>
        </div>

        <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 sm:p-8">
          <h1 className="text-xl font-bold text-zinc-50">Welcome — set up your profile</h1>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">
            This takes 30 seconds and personalizes your workspace. Your name and phone number are required.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="ps-name" className="text-xs text-zinc-400">Full name <span className="text-loss">*</span></Label>
              <Input
                id="ps-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mt-1 h-10 border-zinc-800 bg-zinc-900 text-sm text-zinc-100"
              />
              {touched && issues.name && <p className="mt-1 text-[10px] text-loss">{issues.name}</p>}
            </div>
            <div>
              <Label htmlFor="ps-phone" className="text-xs text-zinc-400">Phone number <span className="text-loss">*</span></Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">+91</span>
                <Input
                  id="ps-phone" type="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, "").slice(0, 12))}
                  placeholder="98765 43210"
                  className="mt-1 h-10 border-zinc-800 bg-zinc-900 pl-11 text-sm text-zinc-100"
                />
              </div>
              {touched && issues.phone && <p className="mt-1 text-[10px] text-loss">{issues.phone}</p>}
            </div>
            <div>
              <Label htmlFor="ps-city" className="text-xs text-zinc-400">City <span className="text-zinc-600">(optional)</span></Label>
              <Input
                id="ps-city" value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="Mumbai"
                className="mt-1 h-10 border-zinc-800 bg-zinc-900 text-sm text-zinc-100"
              />
            </div>

            <div>
              <Label className="text-xs text-zinc-400">Trading experience</Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {EXPERIENCE.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setExperience(e.id)}
                    className={cn(
                      "rounded-xl border px-2 py-2.5 text-center transition-colors",
                      experience === e.id
                        ? "border-brand/60 bg-brand/10"
                        : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-600"
                    )}
                  >
                    <span className={cn("block text-xs font-semibold", experience === e.id ? "text-brand-text" : "text-zinc-200")}>{e.label}</span>
                    <span className="mt-0.5 block text-[9px] leading-3 text-zinc-500">{e.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs text-zinc-400">Focus areas <span className="text-zinc-600">(optional, pick any)</span></Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {INTERESTS.map((i) => {
                  const active = interests.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setInterests((prev) => (active ? prev.filter((p) => p !== i) : [...prev, i]))}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                        active ? "border-brand/60 bg-brand/10 text-brand-text" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                      )}
                    >
                      {active && <CheckCircle2 className="h-3 w-3" />}
                      {i}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="mt-6 h-11 w-full rounded-full bg-brand text-sm font-semibold text-white shadow-lg shadow-brand/25 hover:bg-brand-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : "Enter TradePulse"} <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <button
            onClick={() => void signOutToLanding()}
            className="mt-3 w-full text-center text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
