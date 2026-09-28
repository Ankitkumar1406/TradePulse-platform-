/// <reference types="bun-types" />
/**
 * Probe candidate NSE index symbols on the chart API — keep the ones with a
 * full 2y history (>= 200 bars) for the sector-momentum index table.
 */
import { fetchChart } from "../src/lib/yahoo";

const CANDIDATES: { symbol: string; name: string }[] = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^NSMIDCP", name: "NIFTY NEXT 50" },
  { symbol: "^NSEBANK", name: "NIFTY BANK" },
  { symbol: "^CNXIT", name: "NIFTY IT" },
  { symbol: "^CNXPHARMA", name: "NIFTY PHARMA" },
  { symbol: "^CNXAUTO", name: "NIFTY AUTO" },
  { symbol: "^CNXFMCG", name: "NIFTY FMCG" },
  { symbol: "^CNXMETAL", name: "NIFTY METAL" },
  { symbol: "^CNXREALTY", name: "NIFTY REALTY" },
  { symbol: "^CNXPSUBANK", name: "NIFTY PSU BANK" },
  { symbol: "^CNXENERGY", name: "NIFTY ENERGY" },
  { symbol: "^CNXINFRA", name: "NIFTY INFRA" },
  { symbol: "^CNXMEDIA", name: "NIFTY MEDIA" },
  { symbol: "^CNXFIN", name: "NIFTY FIN SERVICE" },
  { symbol: "NIFTY_FIN_SERVICE.NS", name: "NIFTY FIN SERVICE (.NS)" },
  { symbol: "^CNXSC", name: "NIFTY SMALLCAP 100" },
  { symbol: "^NSEMDCP50", name: "NIFTY MIDCAP 50" },
  { symbol: "NIFTY_MIDCAP_100.NS", name: "NIFTY MIDCAP 100 (.NS)" },
  { symbol: "^CNX500", name: "NIFTY 500" },
  { symbol: "^CRSLDX", name: "NIFTY 500 (CRSLDX)" },
  { symbol: "INDIAVIX.NS", name: "INDIA VIX" },
];

async function main() {
  for (const c of CANDIDATES) {
    try {
      const chart = await fetchChart(c.symbol, "2y");
      const bars = chart.timestamp?.length ?? 0;
      let last: number | null = null;
      let prev: number | null = null;
      if (bars > 0) {
        const closes = chart.indicators.quote[0].close;
        for (let i = bars - 1; i >= 0 && last == null; i--) if (closes[i] != null) last = closes[i];
        for (let i = bars - 2; i >= 0 && prev == null; i--) if (closes[i] != null) prev = closes[i];
      }
      console.log(
        `${bars >= 200 ? "KEEP " : bars >= 20 ? "thin " : "SKIP "} ${c.symbol.padEnd(24)} bars=${String(bars).padStart(4)} last=${last} prev1d=${prev}`,
      );
    } catch (e) {
      console.log(`FAIL  ${c.symbol.padEnd(24)} ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }
}

main();
