import { NextResponse } from "next/server";
import { SCANS, SCAN_CATEGORIES } from "@/lib/scanners";

export const dynamic = "force-dynamic";

/** Scanner catalog grouped by category (order preserved). */
export async function GET() {
  const groups = SCAN_CATEGORIES.map((c) => ({
    category: c.category,
    description: c.description,
    scans: SCANS.filter((s) => s.category === c.category).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      basic: Boolean(s.basic),
      needsBars: Boolean(s.needsBars),
    })),
  }));
  return NextResponse.json({ totalScans: SCANS.length, totalCategories: SCAN_CATEGORIES.length, groups });
}
