const { getBudgetState, formatHours } = require("../../src/budget-state");
const assert = require("assert");

// formatHours
assert(formatHours(14.2) === "14.2", `Expected 14.2, got ${formatHours(14.2)}`);
assert(formatHours(20) === "20", `Expected 20, got ${formatHours(20)}`);
assert(formatHours(0) === "0", `Expected 0, got ${formatHours(0)}`);

// getBudgetState — precise values
const n1 = getBudgetState(0, 10);
assert(n1.state === "normal", `normal at 0%`);
assert(n1.ratio === 0, `ratio 0`);

const n2 = getBudgetState(7.9, 10);
assert(n2.state === "normal", `normal at 79%`);

const w1 = getBudgetState(8, 10);
assert(w1.state === "warning", `warning at 80%`);
assert(w1.ratio === 0.8, `ratio 0.8`);

const w2 = getBudgetState(9.9, 10);
assert(w2.state === "warning", `warning at 99%`);

const o1 = getBudgetState(10, 10);
assert(o1.state === "over", `over at 100%`);

const o2 = getBudgetState(15, 10);
assert(o2.state === "over", `over at 150%`);
assert(o2.ratio === 1.5, `ratio 1.5`);

console.log("✅ All progress-bar tests pass");
