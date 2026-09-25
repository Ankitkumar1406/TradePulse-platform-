import { SUB_TO_GRP, YAHOO_SUB_MAP } from "@/lib/bp-taxonomy";

/**
 * Per-symbol subgroup overrides — fix the places where the Yahoo industry is
 * too coarse for the sector hierarchy (PSU vs private banks,
 * AMC vs broking, tyres vs components, PSU power, media, food subgroups…).
 * Keys are NSE symbols without the .NS suffix.
 */
export const SYMBOL_SUB_OVERRIDES: Record<string, string> = {
  // ---- banks: public sector ------------------------------------------------
  SBIN: "Public Sector Bank", PNB: "Public Sector Bank", BANKBARODA: "Public Sector Bank",
  CANBK: "Public Sector Bank", UNIONBANK: "Public Sector Bank", INDIANB: "Public Sector Bank",
  BANKINDIA: "Public Sector Bank", UCOBANK: "Public Sector Bank", IOB: "Public Sector Bank",
  CENTRALBK: "Public Sector Bank", MAHABANK: "Public Sector Bank", PSB: "Public Sector Bank",
  IDBI: "Public Sector Bank", JKBANK: "Public Sector Bank", PUNJABBANK: "Public Sector Bank",
  // ---- banks: other --------------------------------------------------------
  YESBANK: "Private Sector Bank", IDFCFIRSTB: "Private Sector Bank", AUBANK: "Private Sector Bank",
  // ---- housing finance -----------------------------------------------------
  LICHSGFIN: "Housing Finance Company", PNBHOUSING: "Housing Finance Company",
  CANFINHOME: "Housing Finance Company", GICHOUSING: "Housing Finance Company",
  AAVAS: "Housing Finance Company", BAJAJHFL: "Housing Finance Company",
  // ---- capital markets -----------------------------------------------------
  HDFCAMC: "Asset Management Company", "NAM-INDIA": "Asset Management Company",
  UTIAMC: "Asset Management Company", ABSLAMC: "Asset Management Company",
  BSE: "Exchange and Data Platform", MCX: "Exchange and Data Platform",
  CDSL: "Depositories, Clearing Houses and Other Intermediaries",
  CAMS: "Depositories, Clearing Houses and Other Intermediaries",
  CRISIL: "Ratings", ICRA: "Ratings", CARERATING: "Ratings",
  ANANDRATHI: "Stockbroking & Allied", MOTILALOFS: "Stockbroking & Allied",
  IIFL: "Stockbroking & Allied", ANGELONE: "Stockbroking & Allied",
  "360ONE": "Asset Management Company", NUVAMA: "Stockbroking & Allied",
  // ---- insurance -----------------------------------------------------------
  SBILIFE: "Life Insurance", HDFCLIFE: "Life Insurance", ICICIPRULI: "Life Insurance",
  LICI: "Life Insurance", SBIG: "General Insurance",
  ICICIGI: "General Insurance", ICICILOMB: "General Insurance", GICRE: "General Insurance",
  NIACL: "General Insurance", STARHEALTH: "General Insurance",
  POLICYBZR: "Insurance Distributors",
  // ---- fintech ---------------------------------------------------------------
  PAYTM: "Financial Technology (Fintech)", JIOFIN: "Financial Technology (Fintech)",
  ZOMATO: "E-Retail/ E-Commerce", ETERNAL: "E-Retail/ E-Commerce", NYKAA: "E-Retail/ E-Commerce",
  // ---- FMCG splits -----------------------------------------------------------
  HINDUNILVR: "Diversified FMCG", PATANJALI: "Diversified FMCG", ITC: "Diversified FMCG",
  TATACONSUM: "Diversified FMCG", GODREJCP: "Personal Care", DABUR: "Personal Care",
  EMAMILTD: "Personal Care", MARICO: "Personal Care", COLPAL: "Personal Care",
  JYOTHYLAB: "Personal Care", BAJAJCON: "Personal Care", GILLETTE: "Personal Care",
  // ---- foods -----------------------------------------------------------------
  AWL: "Edible Oil", GOKULAGRO: "Edible Oil", SANCO: "Edible Oil",
  HATSUN: "Dairy Products", HERITGFOOD: "Dairy Products", DODLA: "Dairy Products",
  VENKEYS: "Meat Products including Poultry", SKMEGG: "Meat Products including Poultry",
  AVANTIFEED: "Seafood", APEX: "Seafood",
  BALRAMCHIN: "Sugar", RENUKA: "Sugar", DWARKESH: "Sugar", DHAMPURSUG: "Sugar",
  MAGADSUGAR: "Sugar", UGARSUGAR: "Sugar", PONNIERODE: "Sugar", DCMSHRIRAM: "Sugar",
  MCLEODRUSS: "Tea & Coffee", HARRMALAYA: "Tea & Coffee", CCL: "Tea & Coffee",
  // ---- beverages ---------------------------------------------------------------
  VARBEV: "Other Beverages", UBL: "Breweries & Distilleries", UNITDSPR: "Breweries & Distilleries",
  RADICO: "Breweries & Distilleries", GLOBUSSPR: "Breweries & Distilleries",
  SULA: "Breweries & Distilleries", TILAKNAGAR: "Breweries & Distilleries",
  // ---- tobacco ----------------------------------------------------------------
  VSTIND: "Cigarettes & Tobacco Products", GOLDENTOBA: "Cigarettes & Tobacco Products",
  NTCINDIA: "Cigarettes & Tobacco Products",
  // ---- consumer durables -------------------------------------------------------
  TITAN: "Gems, Jewellery And Watches", KALYANKJIL: "Gems, Jewellery And Watches",
  THANGAMAYL: "Gems, Jewellery And Watches", RAJESHEXPO: "Gems, Jewellery And Watches",
  PCJEWELLER: "Gems, Jewellery And Watches", SENCO: "Gems, Jewellery And Watches",
  VOLTAS: "Household Appliances", BLUESTARCO: "Household Appliances",
  CROMPTON: "Household Appliances", WHIRLPOOL: "Household Appliances",
  SYMPHONY: "Household Appliances", IFBIND: "Household Appliances", HAVELLS: "Household Appliances",
  TTKPRESTIG: "Houseware", HAWKINCOOK: "Houseware", STOVEKRAFT: "Houseware",
  CELLO: "Houseware", LAOPALA: "Houseware",
  BOROSIL: "Glass - Consumer",
  CERA: "Sanitary Ware", HSIL: "Sanitary Ware",
  KAJARIACER: "Ceramics", SOMANYCERA: "Ceramics", NITCO: "Ceramics",
  CENTURYPLY: "Plywood Boards/ Laminates", GREENPLY: "Plywood Boards/ Laminates",
  GREENLAM: "Plywood Boards/ Laminates", ARCHIDPLY: "Plywood Boards/ Laminates",
  DIXON: "Consumer Electronics", AMBER: "Consumer Electronics", VGUARD: "Other Electrical Equipment",
  ASTRAZEN: "Pharmaceuticals",
  // ---- paints ------------------------------------------------------------------
  ASIANPAINT: "Paints", BERGEPAINT: "Paints", KANSAINER: "Paints", INDIGOPNTS: "Paints",
  // ---- autos -------------------------------------------------------------------
  ASHOKLEY: "Commercial Vehicles", SMLISUZU: "Commercial Vehicles", OLECTRA: "Commercial Vehicles",
  EICHERMOT: "Commercial Vehicles", VECLV: "Commercial Vehicles",
  HEROMOTOCO: "2/3 Wheelers", "BAJAJ-AUTO": "2/3 Wheelers", TVSMOTOR: "2/3 Wheelers",
  ESCORTS: "Tractors", VSTTILLERS: "Tractors",
  MRF: "Tyres & Rubber Products", BALKRISIND: "Tyres & Rubber Products",
  APOLLOTYRE: "Tyres & Rubber Products", CEATLTD: "Tyres & Rubber Products", JKTYRE: "Tyres & Rubber Products",
  BHARATFORG: "Castings & Forgings", RAMKRISHNA: "Castings & Forgings",
  // ---- IT / software ------------------------------------------------------------
  TCS: "Computers - Software & Consulting", INFY: "Computers - Software & Consulting",
  WIPRO: "Computers - Software & Consulting", HCLTECH: "Computers - Software & Consulting",
  TECHM: "Computers - Software & Consulting", LTIM: "Computers - Software & Consulting",
  LTTS: "Computers - Software & Consulting", PERSISTENT: "Computers - Software & Consulting",
  COFORGE: "Computers - Software & Consulting", MPHASIS: "Computers - Software & Consulting",
  TATAELXSI: "Computers - Software & Consulting", OFSS: "Computers - Software & Consulting",
  ZENSARTECH: "Computers - Software & Consulting", CYIENT: "Computers - Software & Consulting",
  NEWGEN: "Software Products", INTELLECT: "Software Products", KELLTONTEC: "Software Products",
  // ---- telecom ------------------------------------------------------------------
  TATACOMM: "Other Telecom Services", INDUSTOWER: "Telecom - Infrastructure",
  HFCL: "Telecom - Infrastructure", STLTECH: "Telecom - Infrastructure",
  RAILTEL: "Telecom - Infrastructure",
  // ---- electricals ---------------------------------------------------------------
  CGPOWER: "Heavy Electrical Equipment", BHEL: "Heavy Electrical Equipment",
  ABB: "Heavy Electrical Equipment", SIEMENS: "Heavy Electrical Equipment",
  HITACHIENERGY: "Heavy Electrical Equipment", THERMAX: "Industrial Machinery",
  POLYCAB: "Cables - Electricals", KEI: "Cables - Electricals",
  RRKABEL: "Cables - Electricals", FINCABLES: "Cables - Electricals",
  // ---- metals ---------------------------------------------------------------------
  VEDL: "Diversified Metals", HINDALCO: "Aluminium", NATIONALUM: "Aluminium",
  HINDZINC: "Zinc", HINDCOPPER: "Copper",
  MOIL: "Ferro & Silica Manganese", NMDC: "Industrial Minerals", GMDC: "Industrial Minerals",
  APLAPOLLO: "Iron & Steel Products", RATNAMANI: "Iron & Steel Products",
  JINDALSAW: "Iron & Steel Products", WELCORP: "Iron & Steel Products",
  JINDALSTEL: "Iron & Steel Products",
  // ---- power / energy ------------------------------------------------------------
  TATAPOWER: "Integrated Power Utilities", POWERGRID: "Power - Transmission",
  TORNTPOWER: "Power Distribution", CESC: "Power Distribution",
  ADANIENSOL: "Power - Transmission", ADANIGREEN: "Power Generation",
  ADANIPOWER: "Power Generation", NTPC: "Power Generation", JSWENERGY: "Power Generation",
  ATGL: "LPG/CNG/PNG/LNG Supplier", GSPL: "Gas Transmission/Marketing",
  GUJGASLTD: "Gas Transmission/Marketing", MGL: "Gas Transmission/Marketing",
  IGL: "Gas Transmission/Marketing",
  DREDGECORP: "Dredging", ABAN: "Offshore Support Solution Drilling",
  // ---- transport infra -------------------------------------------------------------
  RVNL: "Road AssetsToll, Annuity, Hybrid-Annuity", IRCON: "Road AssetsToll, Annuity, Hybrid-Annuity",
  IRB: "Road AssetsToll, Annuity, Hybrid-Annuity", GMRINFRA: "Airport & Airport services",
  ADANIPORTS: "Port & Port services", JSWINFRA: "Port & Port services",
  GRSE: "Ship Building & Allied Services", COCHINSHIP: "Ship Building & Allied Services",
  MAZDOCK: "Ship Building & Allied Services",
  TITAGARH: "Railway Wagons", JUPERWAGNS: "Railway Wagons", TEXMACO: "Railway Wagons",
  IRFC: "Financial Institution",
  // ---- chemicals ------------------------------------------------------------------
  PIIND: "Pesticides & Agrochemicals", UPL: "Pesticides & Agrochemicals",
  BAYERCROP: "Pesticides & Agrochemicals", RALLIS: "Pesticides & Agrochemicals",
  SUMITOCHEM: "Pesticides & Agrochemicals", HERANBA: "Pesticides & Agrochemicals",
  GODREJAGRO: "Pesticides & Agrochemicals", DHANUKA: "Pesticides & Agrochemicals",
  VINATIORGA: "Pesticides & Agrochemicals",
  ATUL: "Commodity Chemicals", TATACHEM: "Commodity Chemicals", GNFC: "Fertilizers",
  DEEPAKNTR: "Commodity Chemicals", AARTIIND: "Commodity Chemicals", NAVINFLUOR: "Specialty Chemicals",
  // ---- media / entertainment ---------------------------------------------------------
  PVRINOX: "Film Production, Distribution & Exhibition", SUNTV: "TV Broadcasting & Software Production",
  ZEEL: "TV Broadcasting & Software Production", SAREGAMA: "Media & Entertainment",
  TIPSMUSIC: "Media & Entertainment", NAZARA: "Digital Entertainment",
  HTMEDIA: "Print Media", DBCORP: "Print Media", JAGRAN: "Print Media",
  NETWORK28: "TV Broadcasting & Software Production",
  // ---- healthcare ----------------------------------------------------------------------
  SYNGENE: "Healthcare Research, Analytics & Technology",
  METROPOLIS: "Healthcare Research, Analytics & Technology",
  LALPATHLAB: "Healthcare Research, Analytics & Technology", THYROCARE: "Healthcare Research, Analytics & Technology",
  MEDPLUS: "Pharmacy Retail", APOLLOHOSP: "Hospital", FORTIS: "Hospital",
  NH: "Hospital", KIMS: "Hospital", RAINBOW: "Hospital", MAXHEALTHI: "Hospital",
  // ---- industrial misc -------------------------------------------------------------------
  TIMKEN: "Abrasives & Bearings", SKFINDIA: "Abrasives & Bearings", SCHAEFFLER: "Abrasives & Bearings",
  GRINDWELL: "Abrasives & Bearings", NRB: "Abrasives & Bearings",
  KIRLOSENG: "Industrial Machinery", KIRLOSBROS: "Industrial Machinery", ELGIEQUIP: "Industrial Machinery",
  AIAENG: "Industrial Machinery", ABBOTINDIA: "Pharmaceuticals",
  REDINGTON: "Trading & Distributors", CONCOR: "Logistics Solution Provider",
  DELHIVERY: "Logistics Solution Provider", GATEWAY: "Logistics Solution Provider",
  BLUEDART: "Logistics Solution Provider",
  GRASIM: "Cement & Cement Products", ULTRACEMCO: "Cement & Cement Products",
  SHREECEM: "Cement & Cement Products", AMBUJACEM: "Cement & Cement Products",
  ACC: "Cement & Cement Products", DALBHARAT: "Cement & Cement Products",
  RAMCOCEM: "Cement & Cement Products", JKCEMENT: "Cement & Cement Products",
  BIRLACORPN: "Other Construction Materials", SUPREMEIND: "Plastic Products - Industrial",
  FINPIPE: "Iron & Steel Products", ASTRAL: "Plastic Products - Industrial",
  PRINCEPIPE: "Plastic Products - Industrial", TIMETECHNO: "Plastic Products - Industrial",
};

export interface Taxonomy {
  grp: string;
  sub: string;
}

const FALLBACK_SUB_BY_SECTOR: Record<string, string> = {
  Technology: "IT Enabled Services",
  "Financial Services": "Other Financial Services",
  Healthcare: "Healthcare Service Provider",
  "Consumer Cyclical": "Other Consumer Services",
  "Consumer Defensive": "Other Food Products",
  Industrials: "Other Industrial Products",
  "Basic Materials": "Commodity Chemicals",
  Energy: "Oil Exploration & Production",
  Utilities: "Multi Utilities",
  "Real Estate": "Residential, Commercial Projects",
  "Communication Services": "Media & Entertainment",
};

/**
 * Resolve the { industry, subgroup } classification for a stock.
 * Order: per-symbol override -> Yahoo industry map -> sector fallback.
 * The industry level is always derived from the subgroup via SUB_TO_GRP, so
 * the hierarchy stays exactly the reference's.
 */
export function resolveTaxonomy(symbolRaw: string, sector?: string | null, industry?: string | null): Taxonomy {
  const symbol = symbolRaw.replace(/\.NS$/, "");
  const sub = SYMBOL_SUB_OVERRIDES[symbol] ?? (industry ? YAHOO_SUB_MAP[industry] : undefined) ??
    (sector ? FALLBACK_SUB_BY_SECTOR[sector] : undefined) ?? "Other Industrial Products";
  const grp = SUB_TO_GRP[sub] ?? sector ?? "Diversified";
  return { grp, sub };
}
