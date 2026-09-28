/**
 * Probe for the SlotInput state machine (Task 56, Deliverable 2).
 * Replays click/keyboard action sequences and asserts the resulting draft —
 * these are the same scripts the /lab page runs.
 * Run: bun scripts/test-slot-machine.ts
 */
import { initMachine, applyActions, reduceMachine, canFinish, unitWarning, curExpr } from "../src/lib/scan/slot-machine";
import type { SMAction, SMState } from "../src/lib/scan/slot-machine";
import "../src/lib/scan/registry-items";
import { byId } from "../src/lib/scan/registry";
import { exprSentence } from "../src/lib/scan/expr-display";
import type { Expr } from "../src/lib/scan/expr-model";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}
const item = (id: string) => {
  const it = byId(id);
  if (!it) throw new Error(`registry missing ${id}`);
  return it;
};

// ---------------------------------------------------------------- scripts

const DEMO_SIMPLE: SMAction[] = [
  { a: "pick", item: item("mcap") },
  { a: "comparator", cmp: "gt" },
  { a: "number", raw: "3cr" },
  { a: "finish" },
];

const DEMO_MATH_RIGHT: SMAction[] = [
  { a: "pick", item: item("volume") },
  { a: "comparator", cmp: "gt" },
  { a: "pick", item: item("sma") },
  { a: "removeLast" },
  { a: "pick", item: item("volume") },
  { a: "nextParam" },
  { a: "nextParam" },
  { a: "math", op: "*" },
  { a: "number", raw: "0.75" },
  { a: "finish" },
];

const DEMO_RANGE: SMAction[] = [
  // ( Max(7, 1 day ago High) − Min(7, 1 day ago Low) ) / Min(7, 1 day ago Low) × 100 < 12
  { a: "openBracket" },
  { a: "pick", item: item("winMax") },
  { a: "nextParam" }, // → x slot (Low)
  { a: "removeLast" },
  { a: "pick", item: item("high") },
  { a: "patchTerm", side: "left", path: [{ i: 0 }, { i: 0, arg: 1 }, { i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "nextParam" }, // Max done → still inside the bracket
  { a: "math", op: "-" }, // − Min stays INSIDE the brackets
  { a: "pick", item: item("winMin") },
  { a: "nextParam" },
  { a: "removeLast" },
  { a: "pick", item: item("low") },
  { a: "patchTerm", side: "left", path: [{ i: 0 }, { i: 2, arg: 1 }, { i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "nextParam" },
  { a: "closeBracket" }, // ( Max − Min ) complete
  { a: "math", op: "/" },
  { a: "pick", item: item("winMin") },
  { a: "nextParam" },
  { a: "removeLast" },
  { a: "pick", item: item("low") },
  { a: "patchTerm", side: "left", path: [{ i: 2, arg: 1 }, { i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "nextParam" },
  { a: "math", op: "*" },
  { a: "number", raw: "100" },
  { a: "comparator", cmp: "lt" },
  { a: "number", raw: "12" },
  { a: "finish" },
];

const DEMO_NESTED: SMAction[] = [
  { a: "pick", item: item("atr") },
  { a: "nextParam" },
  { a: "patchTerm", side: "left", path: [{ i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "comparator", cmp: "lt" },
  { a: "pick", item: item("sma") },
  { a: "removeLast" },
  { a: "pick", item: item("atr") },
  { a: "nextParam" },
  { a: "nextParam" },
  { a: "nextParam" },
  { a: "patchTerm", side: "right", path: [{ i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "finish" },
];

// ---------------------------------------------------------------- tests

console.log("— acceptance scripts —");
const s1 = applyActions(initMachine(), DEMO_SIMPLE);
ok(s1.phase === "done", "simple: done");
ok(s1.left.length === 1 && s1.left[0].t === "attr" && s1.left[0].name === "mcap", "simple: left = Market cap");
ok(s1.right.length === 1 && s1.right[0].t === "number" && s1.right[0].value === 3e7, "simple: 3cr → 30000000");
ok(canFinish(s1).ok, "simple: canFinish");
console.log(`    ${exprSentence(s1.left)} > ${exprSentence(s1.right)}`);

const s2 = applyActions(initMachine(), DEMO_MATH_RIGHT);
ok(s2.phase === "done", "math-right: done");
const r2 = s2.right;
ok(r2.length === 3, "math-right: 3 tokens on right");
ok(r2[0].t === "fn" && r2[0].args[0][0].t === "attr" && r2[0].args[0][0].name === "volume", "math-right: Sma(Volume, 20)");
ok(r2[1].t === "op" && r2[1].op === "*", "math-right: × operator");
ok(r2[2].t === "number" && r2[2].value === 0.75, "math-right: 0.75");
console.log(`    ${exprSentence(s2.left)} > ${exprSentence(s2.right)}`);

const s3 = applyActions(initMachine(), DEMO_RANGE);
ok(s3.phase === "done", "range: done");
ok(s3.left.length === 5, `range: left has 5 tokens (got ${s3.left.length})`);
const b = s3.left[0];
ok(b.t === "bracket" && b.inner.length === 3, "range: bracket holds Max − Min");
if (b.t === "bracket") {
  const wmax = b.inner[0];
  ok(wmax.t === "fn" && wmax.name === "winMax", "range: Max present");
  ok(wmax.t === "fn" && wmax.args[0][0].t === "number" && wmax.args[0][0].value === 22, "range: Max n default 22 (script only rewrites x)");
  ok(wmax.t === "fn" && wmax.args[1][0].t === "attr" && wmax.args[1][0].name === "high", "range: Max(·, High)");
  ok(wmax.t === "fn" && wmax.args[1][0].t === "attr" && wmax.args[1][0].offset?.n === 1 && wmax.args[1][0].offset?.unit === "day", "range: 1 day ago High on the param");
}
const divisor = s3.left[2];
ok(divisor.t === "fn" && divisor.args[1][0].t === "attr" && divisor.args[1][0].offset?.unit === "day", "range: divisor Min has 1-day-ago Low");
ok(canFinish(s3).ok, "range: canFinish");
console.log(`    ${exprSentence(s3.left)} < ${exprSentence(s3.right)}`);

const s4 = applyActions(initMachine(), DEMO_NESTED);
ok(s4.phase === "done", "nested: done");
const r4 = s4.right[0];
ok(r4.t === "fn" && r4.name === "sma", "nested: right is Sma");
ok(r4.t === "fn" && r4.args[0][0].t === "fn" && r4.args[0][0].name === "atr", "nested: Sma(ATR(14), 20) — fn inside param");
ok(r4.t === "fn" && r4.offset?.unit === "day" && r4.offset?.n === 1, "nested: 1 day ago prefix on the Sma token");
ok(s4.left[0].t === "fn" && s4.left[0].offset?.unit === "day", "nested: 1 day ago on left ATR");
console.log(`    ${exprSentence(s4.left)} < ${exprSentence(s4.right)}`);

console.log("— correction & safety —");
let s5: SMState = applyActions(initMachine(), DEMO_MATH_RIGHT);
for (let i = 0; i < 12; i++) s5 = reduceMachine(s5, { a: "removeLast" });
ok(s5.phase === "left" && s5.left.length === 0 && s5.cmp === null, "backspace unwinds the whole clause back to empty left");

let s6: SMState = applyActions(initMachine(), [{ a: "openBracket" }, { a: "pick", item: item("close") }]);
ok(s6.stack.length === 1, "bracket frame open");
s6 = reduceMachine(s6, { a: "comparator", cmp: "gt" });
ok(s6.phase === "right" && s6.stack.length === 0 && s6.left[0].t === "bracket", "comparator auto-closes the open bracket");

let s7: SMState = applyActions(initMachine(), [{ a: "pick", item: item("close") }, { a: "comparator", cmp: "gt" }, { a: "pick", item: item("changePct") }]);
ok(unitWarning(s7) !== null, `unit warning fires (₹ vs %): ${unitWarning(s7)}`);
s7 = reduceMachine(s7, { a: "removeLast" });
ok(unitWarning(s7) === null, "right side cleared → no unit warning");

let s8: SMState = applyActions(initMachine(), [{ a: "pick", item: item("rsi") }, { a: "removeLast" }]);
ok(s8.expect === "operand" && s8.left[0].t === "fn" && s8.left[0].args[0].length === 0, "cleared param → empty slot kept (dashed-red state), fn survives");
s8 = reduceMachine(s8, { a: "number", raw: "3cr" });
ok(s8.error !== null && s8.left[0].t === "fn" && s8.left[0].args[0].length === 0, `param constraint rejects 3cr as period: ${s8.error}`);
s8 = reduceMachine(s8, { a: "number", raw: "14" });
ok(s8.error === null && s8.expect === "continue", "period 14 accepted");
s8 = reduceMachine(s8, { a: "removeFrame" });
ok(s8.left.length === 0 && s8.stack.length === 0 && s8.expect === "operand", "removeFrame deletes the whole function");

let s9: SMState = applyActions(initMachine(), [{ a: "pick", item: item("close") }, { a: "comparator", cmp: "withinPct" }, { a: "pick", item: item("high52") }, { a: "finish" }]);
ok(s9.phase === "pct", "withinPct → pct phase");
s9 = reduceMachine(s9, { a: "number", raw: "2" });
ok(s9.phase === "done" && s9.pct === 2, "pct 2 committed → done");

let s10: SMState = applyActions(initMachine(), [{ a: "pick", item: item("close") }, { a: "comparator", cmp: "between" }, { a: "number", raw: "50" }, { a: "finish" }]);
ok(s10.phase === "right2", "between → upper-bound phase");
s10 = reduceMachine(s10, { a: "number", raw: "100" });
s10 = reduceMachine(s10, { a: "finish" });
ok(s10.phase === "done" && s10.right2[0].t === "number", "between done with right2 = 100");

const s11 = applyActions(initMachine(), [{ a: "pick", item: item("sector") }, { a: "comparator", cmp: "textEq" }, { a: "text", value: "FMCG" }, { a: "finish" }]);
ok(s11.phase === "done" && s11.right[0].t === "text" && s11.right[0].value === "FMCG", "text clause: Sector equals FMCG");

const s12b = applyActions(initMachine(), [{ a: "pick", item: item("doji") }, { a: "comparator", cmp: "isTrue" }, { a: "finish" }]);
ok(s12b.phase === "done" && s12b.right.length === 0, "flag clause: Doji is true (no right side)");

const cursorAt = (s: SMState): Expr => curExpr(s);
const s13 = applyActions(initMachine(), [{ a: "pick", item: item("stochD") }]);
ok(cursorAt(s13).length === 1 && s13.expect === "continue", "fn param slot pre-filled → continue");
ok(s13.stack.length === 1 && s13.stack[0].kind === "fn" && s13.stack[0].argIndex === 0, "cursor inside param 0");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
