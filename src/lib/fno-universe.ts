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
