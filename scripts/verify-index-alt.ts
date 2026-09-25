/**
 * Probe alternative Yahoo symbol formats + interval variants for NSE sector indices.
 * Run: bun scripts/verify-index-alt.ts
 */
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" };

const ALT_SYMBOLS = [
  "NIFTYAUTO.NS", "NIFTY_AUTO.NS", "NIFTYFMCG.NS", "NIFTY_FMCG.NS",
  "NIFTYMETAL.NS", "NIFTY_METAL.NS", "NIFTYENERGY.NS", "NIFTY_ENERGY.NS",
  "NIFTYREALTY.NS", "NIFTY_REALTY.NS", "NIFTYPSUBANK.NS", "NIFTY_PSUBANK.NS",
  "NIFTYMEDIA.NS", "NIFTY_MEDIA.NS", "NIFTYINFRA.NS", "NIFTY_INFRA.NS",
  "NIFTYCOMMODITIES.NS", "NIFTY_COMMODITIES.NS",
  "NIFTYMIDCAP100.NS", "NIFTY_MIDCAP100.NS", "NIFTY_MID_SELECT.NS",
  "NIFTYSMLCAP100.NS", "NIFTY_SMLCAP100.NS",
  "NIFTYFINSERVICE.NS", "NIFTY_FIN_SERVICE2.NS", "^NSEFIN",
  "^CRSLDX", "NIFTY_500.NS", "NIFTY500.NS",
];

async function probe(symbol: string, range = "2y", interval = "1d") {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`,
      { headers: UA, signal: AbortSignal.timeout(12000) }
    );
    if (!res.ok) return `${symbol}: HTTP ${res.status}`;
    const j = (await res.json()) as { chart?: { result?: { timestamp?: number[] }[] } };
    const n = j.chart?.result?.[0]?.timestamp?.length ?? 0;
    return `${symbol}: ${n} bars`;
  } catch (e) {
    return `${symbol}: ERR ${e instanceof Error ? e.message : e}`;
  }
}

async function main() {
  console.log("--- interval variants for broken symbols ---");
  for (const s of ["^CNXAUTO", "^CNXFMCG", "^CNXSC"]) {
    console.log(await probe(s, "2y", "1wk"));
    console.log(await probe(s, "2y", "1mo"));
    console.log(await probe(s, "1y", "1d"));
    console.log(await probe(s, "5y", "1d"));
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log("--- alternative symbol names ---");
  for (const s of ALT_SYMBOLS) {
    console.log(await probe(s));
    await new Promise((r) => setTimeout(r, 200));
  }
}
main();
