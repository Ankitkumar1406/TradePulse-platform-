import { NextResponse } from "next/server";
import { debugClauseFull } from "@/lib/scan/evaluate";
import { getStore } from "@/lib/scan/columns";
import type { Clause } from "@/lib/scan/expr-model";

export const dynamic = "force-dynamic";

/**
 * Condition debug — computed left/right values for a clause on a handful of
 * stocks so the user can see WHY something matched or didn't. Without an
 * explicit symbol list the server picks top-market-cap names (the UI passes
 * symbols from the current result page when it has them).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { clause?: Clause; symbols?: string[] };
    const clause = body.clause;
    if (!clause || clause.kind !== "clause") {
      return NextResponse.json({ error: "clause required" }, { status: 400 });
    }
    let symbols = (body.symbols ?? []).filter((s) => typeof s === "string" && s.includes("."));
    if (symbols.length < 8) {
      const store = await getStore();
      const extra = store.symbols
        .filter((s) => !symbols.includes(s))
        .slice(0, 12 - symbols.length);
      symbols = [...symbols, ...extra];
    }
    const rows = await debugClauseFull(clause, symbols.slice(0, 12));
    return NextResponse.json({ debug: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Debug failed" },
      { status: 500 },
    );
  }
}
