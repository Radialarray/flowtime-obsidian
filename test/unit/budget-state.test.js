const { getBudgetState } = require("../../src/budget-state");
const assert = require("assert");

// Normal range
const r1 = getBudgetState(0, 10);
assert(r1.state === "normal", `Expected normal, got ${r1.state}`);
assert(r1.ratio === 0, `Expected ratio 0, got ${r1.ratio}`);

const r2 = getBudgetState(7.9, 10);
assert(r2.state === "normal", `Expected normal at 79%, got ${r2.state}`);

// Warning range
const r3 = getBudgetState(8, 10);
assert(r3.state === "warning", `Expected warning at 80%, got ${r3.state}`);

// Over range
const r4 = getBudgetState(10, 10);
assert(r4.state === "over", `Expected over at 100%, got ${r4.state}`);

const r5 = getBudgetState(15, 10);
assert(r5.state === "over", `Expected over at 150%, got ${r5.state}`);

// Edge cases
const r6 = getBudgetState(-5, 10);
assert(r6.state === "normal", `Expected normal for negative used`);

const r7 = getBudgetState(5, 0);
assert(r7.state === "normal", `Expected normal for zero total`);

const r8 = getBudgetState(5, -1);
assert(r8.state === "normal", `Expected normal for negative total`);

console.log("✅ All budget-state tests pass");
