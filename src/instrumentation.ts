export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Make sure the userspace PostgreSQL cluster is up before the scheduler's
    // boot queries run. pg-ensure.sh is idempotent and returns in ~30ms when
    // the server is already running. Dynamic import keeps the Edge bundler
    // away from node:child_process.
    try {
      const { execSync } = await import("node:child_process");
      execSync("bash scripts/pg-ensure.sh", { stdio: "ignore", timeout: 120_000 });
    } catch {
      /* best-effort — Prisma surfaces a clear error if the DB is unreachable */
    }
    const { startDailySyncScheduler } = await import("@/lib/scheduler");
    startDailySyncScheduler();
  }
}
