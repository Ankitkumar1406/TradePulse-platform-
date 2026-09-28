/**
 * Scan builder — static registry items (Deliverable 1).
 *
 * One factory keeps 240+ entries compact. Defaults per kind:
 *   attr/fn → time-based (tf + offset), returns number, unit none, computed
 *   flag    → time-based, returns boolean, unit bool
 *   text    → no time dimension, returns text
 * Fundamentals override data/periodSelector and drop time support; index
 * context overrides data to yahoo-price.
 *
 * Everything the evaluator will ever touch is on this list — the whitelist
 * in step 5 imports this module directly.
 */
import {
  registerItems,
  type CategoryId,
  type FundPeriod,
  type RegistryItem,
  type RegistryKind,
  type RegistryParam,
  type Unit,
} from "./registry";

// ---------------------------------------------------------------- factories

type Tier = "P0" | "P1" | "P2";
type ItemOpts = Partial<Pick<RegistryItem, "params" | "supportsTimeframe" | "supportsOffset" | "periodSelector" | "returns" | "unit" | "data" | "hint">>;

const TIME_KINDS: RegistryKind[] = ["attr", "fn", "flag", "saved"];

const it = (id: string, label: string, category: CategoryId, kind: RegistryKind, tier: Tier, opts: ItemOpts = {}): RegistryItem => ({
  id,
  label,
  category,
  kind,
  tier,
  supportsTimeframe: TIME_KINDS.includes(kind),
  supportsOffset: TIME_KINDS.includes(kind),
  returns: kind === "flag" ? "boolean" : kind === "text" ? "text" : "number",
  unit: kind === "flag" ? "bool" : kind === "text" ? "text" : "none",
  data: "computed",
  ...opts,
});

const num = (name: string, def: number, o: Partial<RegistryParam> = {}): RegistryParam => ({
  name, type: "number", default: def, int: true, ...o,
});
const exprP = (name: string, def: string, label?: string): RegistryParam => ({
  name, type: "expr", default: def, ...(label ? { label } : {}),
});
const per = (d = 20): RegistryParam => num("period", d, { min: 2, max: 500, label: "period" });
const srcP = (def = "close"): RegistryParam => exprP("source", def, "of");

const WIN = {
  n: (d = 20): RegistryParam => num("n", d, { min: 1, max: 500, label: "lookback bars" }),
  x: (d = "close"): RegistryParam => exprP("x", d, "of"),
};

const TTM_FLOW: FundPeriod[] = ["ttm", "q0", "q1", "q2", "q3"];
const SNAP: FundPeriod[] = ["ttm"];
const QUARTERLY: FundPeriod[] = ["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"];
const ANNUAL: FundPeriod[] = ["fy0", "fy1", "fy2", "fy3", "fy4"];

const ITEMS: RegistryItem[] = [];

// ---------------------------------------------------------------- measures (picker pseudo-items)

ITEMS.push(
  it("group", "Sub-filter / Group", "measures", "group", "P0", {
    supportsTimeframe: false, supportsOffset: false, returns: "boolean",
    hint: "Nest a group with its own all / any N / none",
  }),
  it("number", "Number", "measures", "number", "P0", {
    supportsTimeframe: false, supportsOffset: false,
    hint: "Type a value — 500, 3cr, 50L, 1.5k",
  }),
  it("bracket", "Bracket ( … )", "measures", "bracket", "P0", {
    supportsTimeframe: false, supportsOffset: false,
    hint: "Group part of an expression, e.g. (High − Low)",
  }),
);

// ---------------------------------------------------------------- stock attributes

ITEMS.push(
  it("symbol", "Symbol", "stock-attrs", "text", "P0", { hint: "e.g. RELIANCE" }),
  it("companyName", "Company name", "stock-attrs", "text", "P0"),
  it("sector", "Sector", "stock-attrs", "text", "P0", { hint: "mapped Indian sector name" }),
  it("industry", "Industry", "stock-attrs", "text", "P0", { hint: "mapped Indian industry name" }),
  it("mcapName", "Market cap name", "stock-attrs", "text", "P0", {
    hint: "Large (top 100) / Mid (101–250) / Small (rest)",
  }),
  it("daysSinceFirstTrade", "Days since first trade", "stock-attrs", "attr", "P1", { unit: "days" }),
);

// ---------------------------------------------------------------- price and volume (all P0 unless noted)

ITEMS.push(
  it("open", "Open", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("high", "High", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("low", "Low", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("close", "Close", "price-volume", "attr", "P0", { unit: "Rs", hint: "e.g. 500" }),
  it("volume", "Volume", "price-volume", "attr", "P0", { unit: "shares", hint: "e.g. 1000000 or 10l" }),
  it("prevClose", "Prev close", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("change", "Change", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("changePct", "Change %", "price-volume", "attr", "P0", { unit: "%" }),
  it("gapPct", "Gap %", "price-volume", "attr", "P0", { unit: "%" }),
  it("range", "Range (High − Low)", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("trueRange", "True range", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("typicalPrice", "Typical price (HLC/3)", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("medianPrice", "Median price (HL/2)", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("ohlc4", "OHLC/4", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("tradedValue", "Traded value", "price-volume", "attr", "P0", {
    unit: "Rs", hint: "approx Close × Volume, e.g. 100cr",
  }),
  it("avgVolume", "Avg volume", "price-volume", "fn", "P0", {
    params: [per(20)], unit: "shares", hint: "Avg volume(period 20)",
  }),
  it("relVolume", "Relative volume", "price-volume", "fn", "P0", {
    params: [per(20)], unit: "x", hint: "Volume / Avg volume(20)",
  }),
  it("high52", "52-week high", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("low52", "52-week low", "price-volume", "attr", "P0", { unit: "Rs" }),
  it("ath", "All-time high", "price-volume", "attr", "P0", { unit: "Rs", hint: "within stored history" }),
  it("atl", "All-time low", "price-volume", "attr", "P0", { unit: "Rs", hint: "within stored history" }),
  it("fromHighPct", "% from 52W high", "price-volume", "attr", "P0", { unit: "%" }),
  it("fromLowPct", "% from 52W low", "price-volume", "attr", "P0", { unit: "%" }),
  it("daysSinceHigh52", "Days since 52W high", "price-volume", "attr", "P0", { unit: "days" }),
  it("daysSinceLow52", "Days since 52W low", "price-volume", "attr", "P0", { unit: "days" }),
  it("bodySize", "Body size", "price-volume", "attr", "P1", { unit: "Rs", hint: "|Close − Open|" }),
  it("upperShadow", "Upper shadow", "price-volume", "attr", "P1", { unit: "Rs" }),
  it("lowerShadow", "Lower shadow", "price-volume", "attr", "P1", { unit: "Rs" }),
);

// ---------------------------------------------------------------- moving averages (source Close, period 20 unless noted)

const MA = (id: string, label: string, tier: Tier, period: number, hint?: string, extra: ItemOpts = {}) =>
  ITEMS.push(it(id, label, "moving-averages", "fn", tier, { params: [srcP(), per(period)], unit: "Rs", hint, ...extra }));

MA("sma", "SMA", "P0", 20, "Sma(Daily Volume, 20) — source is an operand");
MA("ema", "EMA", "P0", 20);
MA("wma", "WMA", "P0", 20);
MA("rma", "RMA", "P1", 14, "Wilder's smoothing");
MA("dema", "DEMA", "P1", 20);
MA("tema", "TEMA", "P1", 20);
MA("hma", "HMA", "P1", 20);
MA("vwma", "VWMA", "P1", 20, "volume-weighted");
MA("linreg", "Linear regression value", "P1", 20);
MA("linregSlope", "Linear regression slope", "P1", 20);

// ---------------------------------------------------------------- momentum

ITEMS.push(
  it("rsi", "RSI", "momentum", "fn", "P0", { params: [per(14)], hint: "RSI(14), e.g. 30 / 70" }),
  it("macdLine", "MACD line", "momentum", "fn", "P0", {
    params: [num("fast", 12), num("slow", 26), num("signal", 9)], hint: "MACD(12, 26, 9)",
  }),
  it("macdSignal", "MACD signal", "momentum", "fn", "P0", {
    params: [num("fast", 12), num("slow", 26), num("signal", 9)],
  }),
  it("macdHist", "MACD histogram", "momentum", "fn", "P0", {
    params: [num("fast", 12), num("slow", 26), num("signal", 9)],
  }),
  it("stochK", "Stochastic %K", "momentum", "fn", "P0", {
    params: [per(14), num("kSmooth", 3), num("dPeriod", 3)], hint: "Stoch %K(14, 3, 3)",
  }),
  it("stochD", "Stochastic %D", "momentum", "fn", "P0", {
    params: [per(14), num("kSmooth", 3), num("dPeriod", 3)],
  }),
  it("stochRsi", "StochRSI", "momentum", "fn", "P1", {
    params: [num("rsiPeriod", 14), num("stochPeriod", 14), num("kSmooth", 3), num("dSmooth", 3)],
  }),
  it("williamsR", "Williams %R", "momentum", "fn", "P1", { params: [per(14)], unit: "%" }),
  it("cci", "CCI", "momentum", "fn", "P1", { params: [per(20)] }),
  it("roc", "ROC", "momentum", "fn", "P1", { params: [per(12)], unit: "%" }),
  it("momentum", "Momentum", "momentum", "fn", "P1", { params: [per(10)] }),
  it("mfi", "MFI", "momentum", "fn", "P1", { params: [per(14)] }),
  it("cmo", "CMO", "momentum", "fn", "P1", { params: [per(14)] }),
  it("ppo", "PPO", "momentum", "fn", "P1", {
    params: [num("fast", 12), num("slow", 26), num("signal", 9)], unit: "%",
  }),
  it("trix", "TRIX", "momentum", "fn", "P1", { params: [per(15)] }),
  it("uo", "Ultimate oscillator", "momentum", "fn", "P1", {
    params: [num("p1", 7), num("p2", 14), num("p3", 28)],
  }),
  it("ao", "Awesome oscillator", "momentum", "fn", "P1", { params: [num("fast", 5), num("slow", 34)] }),
);

// ---------------------------------------------------------------- trend

ITEMS.push(
  it("adx", "ADX", "trend", "fn", "P0", { params: [per(14)] }),
  it("plusDI", "+DI", "trend", "fn", "P0", { params: [per(14)] }),
  it("minusDI", "−DI", "trend", "fn", "P0", { params: [per(14)] }),
  it("supertrend", "Supertrend value", "trend", "fn", "P0", {
    params: [per(10), num("mult", 3, { int: false })], unit: "Rs",
  }),
  it("supertrendDir", "Supertrend direction", "trend", "fn", "P0", {
    params: [per(10), num("mult", 3, { int: false })], returns: "boolean", unit: "bool",
    hint: "true = uptrend (close above the line)",
  }),
  it("psar", "Parabolic SAR", "trend", "fn", "P1", {
    params: [num("step", 0.02, { int: false }), num("max", 0.2, { int: false })], unit: "Rs",
  }),
  it("aroonUp", "Aroon up", "trend", "fn", "P1", { params: [per(25)], unit: "%" }),
  it("aroonDown", "Aroon down", "trend", "fn", "P1", { params: [per(25)], unit: "%" }),
  it("aroonOsc", "Aroon oscillator", "trend", "fn", "P1", { params: [per(25)], unit: "%" }),
  it("ichimokuTenkan", "Ichimoku tenkan", "trend", "fn", "P1", {
    params: [num("tenkan", 9), num("kijun", 26), num("senkou", 52)], unit: "Rs",
  }),
  it("ichimokuKijun", "Ichimoku kijun", "trend", "fn", "P1", {
    params: [num("tenkan", 9), num("kijun", 26), num("senkou", 52)], unit: "Rs",
  }),
  it("ichimokuSenkouA", "Ichimoku senkou A", "trend", "fn", "P1", {
    params: [num("tenkan", 9), num("kijun", 26), num("senkou", 52)], unit: "Rs",
  }),
  it("ichimokuSenkouB", "Ichimoku senkou B", "trend", "fn", "P1", {
    params: [num("tenkan", 9), num("kijun", 26), num("senkou", 52)], unit: "Rs",
  }),
  it("ichimokuChikou", "Ichimoku chikou", "trend", "fn", "P1", {
    params: [num("tenkan", 9), num("kijun", 26), num("senkou", 52)], unit: "Rs",
  }),
  it("vortexPlus", "Vortex VI+", "trend", "fn", "P1", { params: [per(14)] }),
  it("vortexMinus", "Vortex VI−", "trend", "fn", "P1", { params: [per(14)] }),
  it("elderBull", "Elder Ray bull", "trend", "fn", "P1", { params: [per(13)], unit: "Rs" }),
  it("elderBear", "Elder Ray bear", "trend", "fn", "P1", { params: [per(13)], unit: "Rs" }),
  it("haOpen", "Heikin-Ashi open", "trend", "attr", "P1", { unit: "Rs" }),
  it("haHigh", "Heikin-Ashi high", "trend", "attr", "P1", { unit: "Rs" }),
  it("haLow", "Heikin-Ashi low", "trend", "attr", "P1", { unit: "Rs" }),
  it("haClose", "Heikin-Ashi close", "trend", "attr", "P1", { unit: "Rs" }),
);

// ---------------------------------------------------------------- volatility

ITEMS.push(
  it("atr", "ATR", "volatility", "fn", "P0", { params: [per(14)], unit: "Rs" }),
  it("bbUpper", "Bollinger upper", "volatility", "fn", "P0", {
    params: [per(20), num("mult", 2, { int: false })], unit: "Rs",
  }),
  it("bbMiddle", "Bollinger middle", "volatility", "fn", "P0", {
    params: [per(20), num("mult", 2, { int: false })], unit: "Rs",
  }),
  it("bbLower", "Bollinger lower", "volatility", "fn", "P0", {
    params: [per(20), num("mult", 2, { int: false })], unit: "Rs",
  }),
  it("bbPctB", "Bollinger %B", "volatility", "fn", "P0", {
    params: [per(20), num("mult", 2, { int: false })], unit: "ratio",
  }),
  it("bbBandwidth", "Bollinger bandwidth", "volatility", "fn", "P0", {
    params: [per(20), num("mult", 2, { int: false })], unit: "%",
  }),
  it("natr", "NATR", "volatility", "fn", "P1", { params: [per(14)], unit: "%" }),
  it("keltnerUpper", "Keltner upper", "volatility", "fn", "P1", {
    params: [per(20), num("emaPeriod", 10), num("mult", 2, { int: false })], unit: "Rs",
  }),
  it("keltnerMiddle", "Keltner middle", "volatility", "fn", "P1", {
    params: [per(20), num("emaPeriod", 10), num("mult", 2, { int: false })], unit: "Rs",
  }),
  it("keltnerLower", "Keltner lower", "volatility", "fn", "P1", {
    params: [per(20), num("emaPeriod", 10), num("mult", 2, { int: false })], unit: "Rs",
  }),
  it("donchianUpper", "Donchian upper", "volatility", "fn", "P1", { params: [per(20)], unit: "Rs" }),
  it("donchianMiddle", "Donchian middle", "volatility", "fn", "P1", { params: [per(20)], unit: "Rs" }),
  it("donchianLower", "Donchian lower", "volatility", "fn", "P1", { params: [per(20)], unit: "Rs" }),
  it("stddev", "Standard deviation", "volatility", "fn", "P1", {
    params: [srcP(), per(20)], hint: "Stddev(Close, 20)",
  }),
  it("histVol", "Historical volatility", "volatility", "fn", "P1", { params: [per(20)], unit: "%" }),
  it("squeezeFlag", "Squeeze flag", "volatility", "attr", "P1", {
    returns: "boolean", unit: "bool", hint: "Bollinger inside Keltner",
  }),
);

// ---------------------------------------------------------------- volume indicators (all P1)

ITEMS.push(
  it("obv", "OBV", "volume-ind", "attr", "P1", { unit: "shares" }),
  it("adLine", "Accumulation / Distribution", "volume-ind", "attr", "P1", { unit: "shares" }),
  it("cmf", "CMF", "volume-ind", "fn", "P1", { params: [per(20)], unit: "ratio" }),
  it("chaikinOsc", "Chaikin oscillator", "volume-ind", "fn", "P1", {
    params: [num("fast", 3), num("slow", 10)], unit: "shares",
  }),
  it("forceIndex", "Force index", "volume-ind", "fn", "P1", { params: [per(13)] }),
  it("volOsc", "Volume oscillator", "volume-ind", "fn", "P1", {
    params: [num("fast", 5), num("slow", 10)], unit: "%",
  }),
  it("eom", "Ease of movement", "volume-ind", "fn", "P1", { params: [per(14)] }),
  it("pvt", "PVT", "volume-ind", "attr", "P1", { unit: "shares" }),
);

// ---------------------------------------------------------------- window functions and pivots

ITEMS.push(
  it("winMax", "Max", "window-pivots", "fn", "P0", {
    params: [WIN.n(22), WIN.x("low")], hint: "Max(22, Daily Low) — highest of x over N bars",
  }),
  it("winMin", "Min", "window-pivots", "fn", "P0", {
    params: [WIN.n(22), WIN.x("low")], hint: "Min(22, Daily Low) — lowest of x over N bars",
  }),
  it("winSum", "Sum", "window-pivots", "fn", "P0", { params: [WIN.n(20), WIN.x()] }),
  it("winAvg", "Avg", "window-pivots", "fn", "P0", { params: [WIN.n(20), WIN.x()] }),
  it("winCount", "Count", "window-pivots", "fn", "P0", {
    params: [WIN.n(10), exprP("cond", "close", "condition")],
    hint: "Count(10, Daily Close > Daily Open) — bars where the condition held",
  }),
  it("winChange", "Change", "window-pivots", "fn", "P0", {
    params: [WIN.n(1), WIN.x()], hint: "Change(1, Close) = Close − 1-bar-ago Close",
  }),
  it("winPctChange", "% change", "window-pivots", "fn", "P0", {
    params: [WIN.n(1), WIN.x()], unit: "%", hint: "% change(1, Close) vs 1 bar ago",
  }),
  it("highest", "Highest", "window-pivots", "fn", "P1", { params: [WIN.n(20), WIN.x()] }),
  it("lowest", "Lowest", "window-pivots", "fn", "P1", { params: [WIN.n(20), WIN.x()] }),
  it("median", "Median", "window-pivots", "fn", "P1", { params: [WIN.n(20), WIN.x()] }),
  it("daysSinceHighest", "Days since highest", "window-pivots", "fn", "P1", {
    params: [WIN.n(20), WIN.x()], unit: "days",
  }),
  it("daysSinceLowest", "Days since lowest", "window-pivots", "fn", "P1", {
    params: [WIN.n(20), WIN.x()], unit: "days",
  }),
);

// Pivot point systems — computed from the PRIOR bar of the selected timeframe.
const PIV_SYSTEMS = ["classic", "fibonacci", "camarilla", "woodie"] as const;
const PIV_LEVELS = ["pp", "r1", "r2", "r3", "s1", "s2", "s3"] as const;
for (const sys of PIV_SYSTEMS) {
  for (const lvl of PIV_LEVELS) {
    ITEMS.push(it(`piv-${sys}-${lvl}`, `Pivot ${lvl.toUpperCase()} (${sys})`, "window-pivots", "attr", "P1", {
      unit: "Rs", hint: "from prior daily / weekly / monthly bar",
    }));
  }
}

ITEMS.push(
  it("insideBar", "Inside bar", "window-pivots", "attr", "P1", {
    returns: "boolean", unit: "bool", hint: "High < prev High and Low > prev Low",
  }),
  it("outsideBar", "Outside bar", "window-pivots", "attr", "P1", {
    returns: "boolean", unit: "bool",
  }),
  it("nr4", "NR4", "window-pivots", "attr", "P1", { returns: "boolean", unit: "bool", hint: "narrowest range of 4" }),
  it("nr7", "NR7", "window-pivots", "attr", "P1", { returns: "boolean", unit: "bool", hint: "narrowest range of 7" }),
);

// ---------------------------------------------------------------- candlestick patterns (boolean flags, all P1)

const PATTERNS: [string, string][] = [
  ["doji", "Doji"],
  ["hammer", "Hammer"],
  ["invHammer", "Inverted hammer"],
  ["hangingMan", "Hanging man"],
  ["shootingStar", "Shooting star"],
  ["marubozu", "Marubozu"],
  ["spinningTop", "Spinning top"],
  ["bullEngulfing", "Bullish engulfing"],
  ["bearEngulfing", "Bearish engulfing"],
  ["bullHarami", "Bullish harami"],
  ["bearHarami", "Bearish harami"],
  ["piercingLine", "Piercing line"],
  ["darkCloud", "Dark cloud cover"],
  ["morningStar", "Morning star"],
  ["eveningStar", "Evening star"],
  ["threeSoldiers", "Three white soldiers"],
  ["threeCrows", "Three black crows"],
  ["tweezerTop", "Tweezer top"],
  ["tweezerBottom", "Tweezer bottom"],
];
for (const [id, label] of PATTERNS) {
  ITEMS.push(it(id, label, "candlestick", "attr", "P1", { returns: "boolean", unit: "bool" }));
}

// ---------------------------------------------------------------- relative strength (precomputed nightly)

ITEMS.push(
  it("rsScore", "RS score", "relative-strength", "attr", "P0", {
    unit: "points", hint: "raw weighted return: 40% last 3M + 20% each prior 3M",
  }),
  it("rsRating", "RS rating (1–99)", "relative-strength", "attr", "P0", {
    unit: "points", hint: "percentile rank across our universe",
  }),
  it("rsRatingAgo", "RS rating N days ago", "relative-strength", "fn", "P0", {
    params: [num("days", 5, { min: 1, max: 500 })], unit: "points",
  }),
  it("rsRatingChange", "RS rating change", "relative-strength", "attr", "P0", { unit: "points" }),
  it("rsVsNifty", "RS vs Nifty 50", "relative-strength", "attr", "P0", {
    unit: "ratio", hint: "stock close / index close",
  }),
  it("ret1D", "Return 1D", "relative-strength", "attr", "P0", { unit: "%" }),
  it("ret1W", "Return 1W", "relative-strength", "attr", "P0", { unit: "%" }),
  it("ret1M", "Return 1M", "relative-strength", "attr", "P0", { unit: "%" }),
  it("ret3M", "Return 3M", "relative-strength", "attr", "P0", { unit: "%" }),
  it("ret6M", "Return 6M", "relative-strength", "attr", "P0", { unit: "%" }),
  it("ret1Y", "Return 1Y", "relative-strength", "attr", "P0", { unit: "%" }),
  it("outperfNifty", "Outperformance vs Nifty", "relative-strength", "attr", "P0", {
    unit: "%", hint: "stock return minus index return",
  }),
  it("rsLineNewHigh", "RS line new high", "relative-strength", "attr", "P1", { returns: "boolean", unit: "bool" }),
  it("sectorRsRank", "Sector RS rank", "relative-strength", "attr", "P1", {
    unit: "points", supportsTimeframe: false, supportsOffset: false,
  }),
  it("industryRsRank", "Industry RS rank", "relative-strength", "attr", "P1", {
    unit: "points", supportsTimeframe: false, supportsOffset: false,
  }),
  it("beta1Y", "Beta 1Y vs Nifty 50", "relative-strength", "attr", "P1", { unit: "ratio" }),
);

// ---------------------------------------------------------------- fundamentals (Yahoo; null ⇒ no match)

const FUND = (
  id: string, label: string, tier: Tier, unit: Unit, periods: FundPeriod[], hint?: string,
) => ITEMS.push(it(id, label, "fundamentals", "attr", tier, {
  unit, data: "yahoo-fundamentals", supportsTimeframe: false, supportsOffset: false,
  periodSelector: periods, ...(hint ? { hint } : {}),
}));

FUND("mcap", "Market cap", "P0", "Rs", SNAP, "e.g. 3cr (₹30M) … 50000cr");
FUND("epsTtm", "EPS (TTM)", "P0", "Rs", TTM_FLOW);
FUND("pe", "P/E (trailing)", "P0", "x", SNAP);
FUND("pb", "P/B", "P0", "x", SNAP);
FUND("divYield", "Dividend yield", "P0", "%", SNAP, "normalised at ingestion (Yahoo mixes % and fractions)");
FUND("roe", "ROE", "P0", "%", SNAP);
FUND("profitMargin", "Profit margin", "P0", "%", SNAP);
FUND("opMargin", "Operating margin", "P0", "%", SNAP);
FUND("debtToEquity", "Debt / equity", "P0", "ratio", SNAP, "normalised at ingestion");
FUND("currentRatio", "Current ratio", "P0", "ratio", SNAP);
FUND("ev", "Enterprise value", "P1", "Rs", SNAP);
FUND("evEbitda", "EV / EBITDA", "P1", "x", SNAP);
FUND("evRevenue", "EV / Revenue", "P1", "x", SNAP);
FUND("psTtm", "P/S (TTM)", "P1", "x", SNAP);
FUND("bookValue", "Book value per share", "P1", "Rs", SNAP);
FUND("dividendRate", "Dividend rate", "P1", "Rs", SNAP);
FUND("payoutRatio", "Payout ratio", "P1", "%", SNAP);
FUND("roa", "ROA", "P1", "%", SNAP);
FUND("grossMargin", "Gross margin", "P1", "%", SNAP);
FUND("quickRatio", "Quick ratio", "P1", "ratio", SNAP);
FUND("revenueTtm", "Revenue (TTM)", "P1", "Rs", TTM_FLOW);
FUND("ebitda", "EBITDA", "P1", "Rs", TTM_FLOW);
FUND("netIncome", "Net income", "P1", "Rs", TTM_FLOW);
FUND("fcf", "Free cash flow", "P1", "Rs", TTM_FLOW);
FUND("ocf", "Operating cash flow", "P1", "Rs", TTM_FLOW);
FUND("totalDebt", "Total debt", "P1", "Rs", SNAP);
FUND("totalCash", "Total cash", "P1", "Rs", SNAP);
FUND("sharesOut", "Shares outstanding", "P1", "shares", SNAP);
FUND("revenueGrowth", "Revenue growth (YoY)", "P1", "%", ANNUAL);
FUND("earningsGrowth", "Earnings growth (YoY)", "P1", "%", ANNUAL);
FUND("epsQuarterly", "EPS (quarterly)", "P1", "Rs", QUARTERLY, "latest available quarter");
FUND("epsGrowthQoQ", "EPS growth QoQ", "P1", "%", QUARTERLY);
FUND("epsGrowthYoY", "EPS growth YoY", "P1", "%", ANNUAL);
FUND("salesQuarterly", "Sales (quarterly)", "P1", "Rs", QUARTERLY);
FUND("netProfitQuarterly", "Net profit (quarterly)", "P1", "Rs", QUARTERLY);
FUND("annualEps", "Annual EPS", "P1", "Rs", ANNUAL);
FUND("epsCagr3Y", "3Y EPS CAGR", "P1", "%", ANNUAL, "only when 4 annual periods exist");

// P2 — kept in the registry but flagged "verify coverage first" (step 4 gates them).
FUND("fwdEps", "Forward EPS (approx)", "P2", "Rs", SNAP);
FUND("fwdPe", "Forward P/E (approx)", "P2", "x", SNAP);
FUND("peg", "PEG (approx)", "P2", "ratio", SNAP);
FUND("instHoldingPct", "Institutional holding % (proxy)", "P2", "%", SNAP);
FUND("insiderHoldingPct", "Insider holding % (proxy)", "P2", "%", SNAP);

// ---------------------------------------------------------------- index context (Yahoo index symbols)

const INDICES: [string, string, Tier, string, Unit][] = [
  ["nifty50", "Nifty 50", "P0", "^NSEI", "Rs"],
  ["banknifty", "Bank Nifty", "P0", "^NSEBANK", "Rs"],
  ["sensex", "Sensex", "P0", "^BSESN", "Rs"],
  ["niftyit", "Nifty IT", "P0", "^CNXIT", "Rs"],
  ["indiavix", "India VIX", "P0", "^INDIAVIX", "%"],
  ["niftymidcap100", "Nifty Midcap 100", "P2", "^NSEMDCP50", "Rs"], // only if it returns stable data
];
for (const [id, label, tier, ysym, closeUnit] of INDICES) {
  ITEMS.push(it(`${id}Close`, `${label} close`, "index-context", "attr", tier, {
    unit: closeUnit, data: "yahoo-price", hint: ysym,
  }));
  ITEMS.push(it(`${id}ChangePct`, `${label} change %`, "index-context", "attr", tier, {
    unit: "%", data: "yahoo-price", hint: ysym,
  }));
}

// ---------------------------------------------------------------- math functions (pairwise / unary)

const MATH = (id: string, label: string, params: RegistryParam[], hint?: string) =>
  ITEMS.push(it(id, label, "math-fns", "fn", "P0", { params, hint }));

MATH("abs", "Abs", [exprP("x", "close", "of")], "Abs(Daily Close − Daily Open)");
MATH("max2", "Max (a, b)", [exprP("a", "close"), exprP("b", "close")], "Max(Daily High, Daily Close)");
MATH("min2", "Min (a, b)", [exprP("a", "close"), exprP("b", "close")]);
MATH("round", "Round", [exprP("x", "close"), num("digits", 0, { min: 0, max: 6 })]);
MATH("floor", "Floor", [exprP("x", "close")]);
MATH("ceil", "Ceil", [exprP("x", "close")]);
MATH("sqrt", "Sqrt", [exprP("x", "volume")]);
MATH("log", "Log (base 10)", [exprP("x", "volume")]);
MATH("ln", "Ln (natural)", [exprP("x", "volume")]);
MATH("exp", "Exp", [exprP("x", "close")]);
MATH("sign", "Sign", [exprP("x", "close")]);

// ---------------------------------------------------------------- register & helpers

registerItems(ITEMS);

/** Saved formulas become picker items at runtime (category: Saved formulas). */
export function makeSavedItems(saved: { id: string; label: string }[]): RegistryItem[] {
  return saved.map((s) => it(`saved:${s.id}`, s.label, "saved", "saved", "P0", {
    supportsTimeframe: true, supportsOffset: true, hint: "saved formula",
  }));
}

export { ITEMS as REGISTRY_ITEMS };
