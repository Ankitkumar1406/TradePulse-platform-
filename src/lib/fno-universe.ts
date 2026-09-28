/**
 * Approximate NSE F&O (derivatives-eligible) universe, by Yahoo ticker root
 * (without the .NS suffix).
 *
 * NSE revises the F&O list on periodic re-verification, so this curated set
 * is an approximation rather than the live contract master — it covers the
 * stable, long-standing derivatives names (what breadth traders mean by
 * "F&O breadth"). Known ticker changes are tracked (e.g. ZOMATO → ETERNAL).
 * A little drift at the mid-cap edge doesn't materially move aggregate
 * breadth. Verify membership on nseindia.com before trading.
 */
export const FNO_UNIVERSE: ReadonlySet<string> = new Set([
  // Banks & lenders
  "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "BANKBARODA",
  "PNB", "CANBK", "UNIONBANK", "INDIANB", "BANKINDIA", "FEDERALBNK",
  "IDFCFIRSTB", "BANDHANBNK", "RBLBANK", "YESBANK", "CUB", "AUBANK",
  // NBFCs, brokers & market infrastructure
  "BAJFINANCE", "BAJAJFINSV", "JIOFIN", "SBICARD", "CHOLAFIN", "LICHSGFIN",
  "LTF", "MUTHOOTFIN", "MANAPPURAM", "PFC", "RECLTD", "IRFC", "SHRIRAMFIN",
  "ABCAPITAL", "PEL", "POONAWALLA", "ANGELONE", "MCX", "CDSL", "CAMS",
  "IEX", "BSE",
  // Insurance
  "SBILIFE", "HDFCLIFE", "ICICIGI", "ICICIPRULI", "LICI",
  // New-age / platforms
  "ZOMATO", "ETERNAL", "PAYTM", "NYKAA", "POLICYBZR", "SWIGGY",
  // Energy & utilities
  "RELIANCE", "ONGC", "IOC", "BPCL", "HINDPETRO", "OIL", "GAIL", "PETRONET",
  "IGL", "MGL", "GSPL", "GUJGASLTD", "COALINDIA", "NTPC", "POWERGRID",
  "TATAPOWER", "JSWENERGY", "SJVN", "TORNTPOWER", "CESC", "ADANIENT",
  "ADANIPORTS", "ADANIPOWER", "ADANIENSOL", "ADANIGREEN", "ATGL", "AWL",
  "SUZLON", "INOXWIND",
  // Metals & mining
  "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "HINDCOPPER", "NATIONALUM",
  "SAIL", "JINDALSTEL", "JSL", "APLAPOLLO", "WELCORP", "NMDC",
  // Autos & ancillaries
  "MARUTI", "TATAMOTORS", "M&M", "EICHERMOT", "HEROMOTOCO", "BAJAJ-AUTO",
  "ASHOKLEY", "TVSMOTOR", "ESCORTS", "BOSCHLTD", "MOTHERSON", "BALKRISIND",
  "MRF", "APOLLOTYRE", "CEATLTD", "EXIDEIND", "SONACOMS", "UNOMINDA",
  "ENDURANCE", "TIINDIA", "BHARATFORG", "OLECTRA",
  // FMCG & consumer
  "HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR", "GODREJCP",
  "MARICO", "COLPAL", "EMAMILTD", "VBL", "UNITDSPR", "RADICO", "PATANJALI",
  "TATACONSUM", "JUBLFOOD", "DEVYANI", "PAGEIND", "ABFRL", "TRENT",
  "BATAINDIA",
  // Pharma & healthcare
  "SUNPHARMA", "DRREDDY", "CIPLA", "LUPIN", "AUROPHARMA", "ZYDUSLIFE",
  "TORNTPHARM", "GLENMARK", "BIOCON", "ALKEM", "LAURUSLABS", "SYNGENE",
  "DIVISLAB", "APOLLOHOSP", "MAXHEALTH", "FORTIS", "MEDANTA", "LALPATHLAB",
  "ABBOTINDIA",
  // IT & tech
  "TCS", "INFY", "WIPRO", "HCLTECH", "TECHM", "LTIM", "LTTS", "MPHASIS",
  "COFORGE", "PERSISTENT", "CYIENT", "KPITTECH", "TATAELXSI", "OFSS",
  "BSOFT", "NEWGEN", "TATATECH",
  // Industrials, defence & infra
  "LT", "SIEMENS", "ABB", "CUMMINSIND", "CGPOWER", "BHEL", "BEL", "HAL",
  "BDL", "MAZDOCK", "COCHINSHIP", "RVNL", "IRCTC", "CONCOR", "NCC", "NBCC",
  "KEC", "GMRAIRPORT", "INDIGO", "TITAGARH",
  // Cement & real estate
  "ULTRACEMCO", "SHREECEM", "AMBUJACEM", "ACC", "DALBHARAT", "JKCEMENT",
  "RAMCOCEM", "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD",
  "BRIGADE",
  // Materials, chemicals & paints
  "ASIANPAINT", "BERGEPAINT", "PIDILITIND", "UPL", "PIIND", "COROMANDEL",
  "CHAMBLFERT", "GNFC", "DEEPAKNTR", "SRF", "AARTIIND", "NAVINFLUOR",
  "TATACHEM",
  // Consumer durables, electricals & capital goods
  "TITAN", "KALYANKJIL", "HAVELLS", "VOLTAS", "BLUESTARCO", "CROMPTON",
  "POLYCAB", "KEI", "SUPREMEIND", "ASTRAL", "DIXON", "AMBER", "KAYNES",
  "SYRMA", "ELGIEQUIP", "AIAENG", "SCHAEFFLER", "WHIRLPOOL", "PGEL",
]);

/**
 * Nifty 50 constituents (approximate — the index committee rebalances
 * semi-annually; verify on nseindia.com before trading). Used by the
 * screener's universe bar. drifted tickers are harmless: a symbol that
 * isn't in the DB simply matches nothing.
 */
export const NIFTY50_UNIVERSE: ReadonlySet<string> = new Set([
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
  "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL",
  "CIPLA", "COALINDIA", "DRREDDY", "EICHERMOT", "ETERNAL",
  "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE", "HEROMOTOCO",
  "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY",
  "ITC", "JIOFIN", "JSWSTEEL", "KOTAKBANK", "LT",
  "M&M", "MARUTI", "NESTLEIND", "NTPC", "ONGC",
  "POWERGRID", "RELIANCE", "SBILIFE", "SBIN", "SHRIRAMFIN",
  "SUNPHARMA", "TATACONSUM", "TATAMOTORS", "TATASTEEL", "TCS",
  "TECHM", "TITAN", "TRENT", "ULTRACEMCO", "WIPRO",
]);

/** Universe sets store ticker roots; the DB stores Yahoo symbols with the
 *  ".NS" suffix. Map both lists into DB form for IN (...) clauses. */
export function universeToDbSymbols(set: ReadonlySet<string>): string[] {
  return [...set].map((t) => (t.includes(".") ? t : `${t}.NS`));
}
