import { scanToText, parseScanText } from "../../src/lib/scan/serialize";
import "../../src/lib/scan/registry-items";
import { newGroup, type Clause } from "../../src/lib/scan/expr-model";

const num = (v: number) => ({ t: "number" as const, value: v });
const op = (o: "+" | "-" | "*" | "/") => ({ t: "op" as const, op: o });
const attr = (name: string, offset: import("../../src/lib/scan/expr-model").Offset = null) => ({ t: "attr" as const, name, tf: "daily" as const, offset });

const rangeClause: Clause = {
  id: "c1", kind: "clause",
  left: [
    { t: "bracket", inner: [
      { t: "fn", name: "winMax", tf: "daily", offset: null, args: [[num(22)], [attr("low", { n: 1, unit: "day" })]] },
      op("-"),
      { t: "fn", name: "winMin", tf: "daily", offset: null, args: [[num(22)], [attr("low", { n: 1, unit: "day" })]] },
    ] },
    op("/"),
    { t: "fn", name: "winMin", tf: "daily", offset: null, args: [[num(22)], [attr("low", { n: 1, unit: "day" })]] },
    op("*"),
    num(100),
  ],
  cmp: "lt", right: [num(12)], enabled: true,
};
const text = scanToText({ segment: "cash", root: newGroup("all", [rangeClause]) });
console.log(text);
const p = parseScanText(text);
const toks = require("../../src/lib/scan/serialize");
console.log(p.ok ? "OK" : p.error);
if (!p.ok) {
  // dump parse step-by-step
}
