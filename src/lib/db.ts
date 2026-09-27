import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve the effective database URL.
 *
 * Since the PostgreSQL migration the Prisma client only understands
 * `postgresql:` URLs, but the sandbox platform still exports a legacy SQLite
 * `file:` DATABASE_URL into every spawned process (which would win over the
 * project's .env). When we detect that legacy value, prefer the project's own
 * .env definition instead. On a normal host with a proper postgres:// env var
 * this resolver is a no-op.
 */
function resolveDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (url && !url.startsWith("file:")) return url;
  try {
    const envFile = readFileSync(join(process.cwd(), ".env"), "utf8");
    const match = envFile.match(/^DATABASE_URL=(.+)\s*$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env — fall through */
  }
  return url; // last resort — Prisma raises a clear error for file: URLs
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * Rewrite SQLite-style `?` placeholders into PostgreSQL `$n` numbering.
 * Prisma's $queryRawUnsafe takes connector-native placeholders, and the SQL
 * builders (pro-sql.ts) emit `?` for readability — this adapter converts at
 * the boundary. Only used for call sites that build SQL with `?` params;
 * `Prisma.sql` tagged templates are already connector-agnostic.
 */
export function toPgSql(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * PostgreSQL-compatible "biggest first" ordering for nullable numeric columns.
 *
 * SQLite treats NULL as the smallest value, so `ORDER BY marketCap DESC`
 * parked un-ranked rows at the END of the list. PostgreSQL orders NULLS
 * FIRST on DESC by default — after the migration that flipped every
 * top-N window (scanner candidate pools, screener first page, trickle
 * priority) from the largest liquid names to the 1,000+ rows Yahoo has no
 * market cap for (SME/ETF segment). This helper restores the intended
 * "unranked sorts last" semantics on PostgreSQL while remaining valid
 * Prisma syntax for any provider.
 */
export function descNullsLast<F extends string>(field: F): { [K in F]: { sort: "desc"; nulls: "last" } } {
  return { [field]: { sort: "desc", nulls: "last" } } as { [K in F]: { sort: "desc"; nulls: "last" } };
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
