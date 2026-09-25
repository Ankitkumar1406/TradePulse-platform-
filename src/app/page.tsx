"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Activity, BarChart3, BookOpen, CalendarDays, ChevronDown, ChevronRight, Radar, ScanSearch, Star, User,
} from "lucide-react";
import { Landing } from "@/components/landing";
import { ProfileSetup } from "@/components/profile-setup";
import { SyncBanner } from "@/components/sync-banner";
import { MarketTab } from "@/components/market-tab";
import { ScreenerTab } from "@/components/screener-tab";
import { ScannersTab } from "@/components/scanners-tab";
import { WatchlistTab } from "@/components/watchlist-tab";
import { AlertsTab } from "@/components/alerts-tab";
import { JournalTab } from "@/components/journal-tab";
import { CalendarTab } from "@/components/calendar-tab";
import { StockDetail } from "@/components/stock-detail";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { CancelDialog } from "@/components/cancel-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutToLanding } from "@/lib/logout";
import { cn } from "@/lib/utils";

type TabId = "market" | "screener" | "scanners" | "watchlist" | "alerts" | "journal" | "calendar";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "market", label: "Market", icon: BarChart3 },
  { id: "screener", label: "Screener", icon: Radar },
  { id: "scanners", label: "Scanners", icon: ScanSearch },
  { id: "watchlist", label: "Watchlist", icon: Star },
  { id: "alerts", label: "Alerts", icon: ChevronRight },
  { id: "journal", label: "Journal", icon: BookOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

export default function Home() {
  const { data: session, status } = useSession();
  const [tab, setTab] = useState<TabId>("market");
  const [openStock, setOpenStock] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("stock")?.toUpperCase() ?? null;
  });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const onSelectStock = useCallback((symbol: string) => {
    setOpenStock(symbol);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("stock", symbol);
      window.history.replaceState(null, "", url.toString());
    } catch { /* noop */ }
  }, []);

  const closeStock = useCallback(() => {
    setOpenStock(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("stock");
      window.history.replaceState(null, "", url.toString());
    } catch { /* noop */ }
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Activity className="h-4 w-4 animate-pulse text-brand" /> Loading TradePulse…
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return <Landing />;
  }

  if (!session.user.onboarded) {
    return <ProfileSetup />;
  }

  const isPro = session.user.isPro;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-3 sm:px-4">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand shadow-md shadow-brand/25">
                <Activity className="h-4 w-4 text-white" />
              </span>
              <span className="text-sm font-bold tracking-tight text-zinc-50">
                Trade<span className="text-brand-text">Pulse</span>
              </span>
            </div>
            <SyncBanner compact />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <AccountMenu
              name={session.user.name}
              email={session.user.email}
              isPro={isPro}
              proSource={session.user.proSource}
              autoRenew={session.user.autoRenew}
              trialEndsAt={session.user.trialEndsAt}
              onUpgrade={() => setUpgradeOpen(true)}
              onCancel={() => setCancelOpen(true)}
              />
            </div>
          </div>
        </div>
      </header>

      {/* tabs */}
      <div className="sticky top-14 z-30 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-3 sm:px-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
            <TabsList className="h-11 w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 sm:w-auto">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2.5 text-xs font-medium text-zinc-400 shadow-none transition-colors hover:text-zinc-200 data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-brand-text data-[state=active]:shadow-none"
                >
                  <t.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* content */}
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        {tab === "market" && <MarketTab onSelectStock={onSelectStock} isPro={isPro} onUpgrade={() => setUpgradeOpen(true)} onOpenWatchlist={() => setTab("watchlist")} />}
        {tab === "screener" && <ScreenerTab onSelectStock={onSelectStock} isPro={isPro} onUpgrade={() => setUpgradeOpen(true)} />}
        {tab === "scanners" && <ScannersTab isPro={isPro} onSelectStock={onSelectStock} onUpgrade={() => setUpgradeOpen(true)} />}
        {tab === "watchlist" && <WatchlistTab onSelectStock={onSelectStock} />}
        {tab === "alerts" && <AlertsTab onSelectStock={onSelectStock} />}
        {tab === "journal" && <JournalTab isPro={isPro} onUpgrade={() => setUpgradeOpen(true)} />}
        {tab === "calendar" && <CalendarTab />}
      </main>

      <footer className="mt-auto border-t border-zinc-800/70 py-5 text-center text-[11px] text-zinc-600">
        <div className="mx-auto max-w-7xl px-4">
          <p>
            TradePulse — end-of-day research &amp; scanners covering all NSE-listed equities · data auto-updated every
            trading day at 4:00 pm IST
          </p>
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <Link href="/terms" className="transition-colors hover:text-zinc-400">Terms of Service</Link>
            <span aria-hidden="true">·</span>
            <Link href="/privacy" className="transition-colors hover:text-zinc-400">Privacy Policy</Link>
            <span aria-hidden="true">·</span>
            <Link href="/refund-policy" className="transition-colors hover:text-zinc-400">Refund &amp; Cancellation</Link>
          </p>
          <p className="mt-1.5 text-zinc-700">
            Not investment advice — do your own research or consult a SEBI-registered investment adviser.
          </p>
        </div>
      </footer>

      {openStock && <StockDetail symbol={openStock} open onClose={closeStock} isPro={isPro} />}
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} />
    </div>
  );
}

// ---------------------------------------------------------------- account

function AccountMenu({
  name, email, isPro, proSource, autoRenew, trialEndsAt, onUpgrade, onCancel,
}: {
  name?: string | null;
  email?: string | null;
  isPro: boolean;
  proSource: string;
  autoRenew: boolean;
  trialEndsAt?: string | null;
  onUpgrade: () => void;
  onCancel: () => void;
}) {
  const trialDaysLeft = (() => {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / 86400000) : 0;
  })();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 py-1 pl-1 pr-2.5 transition-colors hover:border-zinc-700">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-[10px] font-bold text-brand-text">
          {(name ?? email ?? "U").slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-24 truncate text-xs font-medium text-zinc-200 sm:block">{name ?? "Account"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 border-zinc-800 bg-zinc-950 text-zinc-200">
        <DropdownMenuLabel className="text-xs">
          <span className="block truncate font-semibold text-zinc-100">{name ?? "Trader"}</span>
          <span className="block truncate font-normal text-zinc-500">{email}</span>
          <span className="mt-1.5 flex items-center gap-1.5">
            {isPro ? (
              <Badge
                variant="outline"
                title={
                  proSource === "trial"
                    ? `15-day Pro trial — ${trialDaysLeft ?? 0} day${trialDaysLeft === 1 ? "" : "s"} left. No card was taken; subscribe anytime to keep Pro.`
                    : autoRenew ? "renews automatically" : "auto-renew cancelled"
                }
                className="border-brand/40 bg-brand/10 text-[10px] text-brand-text"
              >
                <Star className="mr-1 h-2.5 w-2.5" />
                {proSource === "trial" ? `PRO · trial${trialDaysLeft != null ? ` · ${trialDaysLeft}d left` : ""}` : "PRO"}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">BASIC</Badge>
            )}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-zinc-800" />
        {isPro ? (
          proSource === "trial" ? (
            <DropdownMenuItem onClick={onUpgrade} className="text-xs text-brand-text focus:text-brand-text focus:bg-brand/10">
              <Star className="mr-1.5 h-3.5 w-3.5" /> Subscribe to keep Pro
            </DropdownMenuItem>
          ) : autoRenew ? (
            <DropdownMenuItem onClick={onCancel} className="text-xs text-loss focus:text-loss focus:bg-loss/10">
              Cancel auto-renewal
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onUpgrade} className="text-xs text-brand-text focus:text-brand-text">
              Renew subscription
            </DropdownMenuItem>
          )
        ) : (
          <DropdownMenuItem onClick={onUpgrade} className="text-xs text-brand-text focus:text-brand-text">
            <Star className="mr-1.5 h-3.5 w-3.5" /> Upgrade to Pro
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => void signOutToLanding()} className="text-xs">
          <User className="mr-1.5 h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
