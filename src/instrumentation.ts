export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDailySyncScheduler } = await import("@/lib/scheduler");
    startDailySyncScheduler();
  }
}
