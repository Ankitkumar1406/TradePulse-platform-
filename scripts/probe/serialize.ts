import { scanToText, parseScanText } from "../../src/lib/scan/serialize";
import "../../src/lib/scan/registry-items";
import { newClause, newGroup, type Clause } from "../../src/lib/scan/expr-model";

const num = (v: number) => ({ t: "number" as const, value: v });
const op = (o: "+" | "-" | "*" | "/") => ({ t: "op" as const, op: o });
const attr = (name: string, offset = null) => ({ t: "attr" as const, name, tf: "daily" as const, offset });

const anyGroup = newGroup("any", [
  { id: "c3", kind: "clause", left: [{ t: "fn", name: "rsi", tf: "daily", offset: null, args: [[num(14)]] }], cmp: "gt", right: [num(60)], enabled: true },
  { id: "c4", kind: "clause", left: [attr("volume")], cmp: "gt", right: [
    { t: "fn", name: "sma", tf: "daily", offset: null, args: [[attr("volume")], [num(20)]] },
    op("*"), num(2),
  ], enabled: true },
] as Clause[]);

const scan = { segment: "cash" as const, root: newGroup("all", [
  { id: "c2", kind: "clause", left: [attr("mcap")], cmp: "gt", right: [num(1e7)], enabled: true } as Clause,
  anyGroup,
]) };

const text = scanToText(scan);
console.log("=== TEXT ===");
console.log(text);
const parsed = parseScanText(text);
console.log("=== PARSE ===", parsed.ok ? "ok" : parsed.error);
if (parsed.ok) console.log(JSON.stringify(parsed.scan.root.children.map(c => c.kind), null, 0));

const p2 = parseScanText("Daily Close > Daily Sma(Daily Close, 200)\nand Market cap > 5000cr");
console.log("=== IMPORT ===", p2.ok ? "ok" : p2.error);
