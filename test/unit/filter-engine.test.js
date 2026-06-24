const { evaluateFilter } = require("../../src/filter-engine");
const assert = require("assert");

const task = {
	bucket: "deep-work",
	project: "Website",
	priority: null,
	taskDate: "2026-06-24",
	status: " ",
	cleanText: "Write API spec",
	durationMinutes: 90,
};

let pass = 0;
let fail = 0;

function test(desc, fn) {
	try {
		fn();
		pass++;
	} catch (e) {
		fail++;
		console.error(`❌ ${desc}: ${e.message}`);
	}
}

// ── eq ──
test("eq match", () => {
	assert(evaluateFilter({ field: "bucket", op: "eq", value: "deep-work" }, task));
});
test("eq no match", () => {
	assert(!evaluateFilter({ field: "bucket", op: "eq", value: "admin" }, task));
});
test("eq case insensitive", () => {
	assert(evaluateFilter({ field: "bucket", op: "eq", value: "DEEP-WORK" }, task));
});

// ── neq ──
test("neq match", () => {
	assert(evaluateFilter({ field: "bucket", op: "neq", value: "admin" }, task));
});
test("neq no match", () => {
	assert(!evaluateFilter({ field: "bucket", op: "neq", value: "deep-work" }, task));
});

// ── exists ──
test("exists on present field", () => {
	assert(evaluateFilter({ field: "bucket", op: "exists" }, task));
});
test("not exists on null", () => {
	assert(!evaluateFilter({ field: "priority", op: "exists" }, task));
});

// ── not_exists ──
test("not_exists on null field", () => {
	assert(evaluateFilter({ field: "priority", op: "not_exists" }, task));
});
test("not_exists on present", () => {
	assert(!evaluateFilter({ field: "bucket", op: "not_exists" }, task));
});

// ── contains ──
test("contains match", () => {
	assert(evaluateFilter({ field: "text", op: "contains", value: "API" }, task));
});
test("contains no match", () => {
	assert(!evaluateFilter({ field: "text", op: "contains", value: "xyz" }, task));
});
test("contains case insensitive", () => {
	assert(evaluateFilter({ field: "text", op: "contains", value: "api" }, task));
});

// ── numeric ops ──
test("gt", () => {
	assert(evaluateFilter({ field: "duration", op: "gt", value: 60 }, task));
});
test("gt no match", () => {
	assert(!evaluateFilter({ field: "duration", op: "gt", value: 100 }, task));
});
test("gte equal", () => {
	assert(evaluateFilter({ field: "duration", op: "gte", value: 90 }, task));
});
test("gte greater", () => {
	assert(evaluateFilter({ field: "duration", op: "gte", value: 30 }, task));
});
test("lt", () => {
	assert(evaluateFilter({ field: "duration", op: "lt", value: 120 }, task));
});
test("lt no match", () => {
	assert(!evaluateFilter({ field: "duration", op: "lt", value: 60 }, task));
});
test("lte equal", () => {
	assert(evaluateFilter({ field: "duration", op: "lte", value: 90 }, task));
});
test("lte less", () => {
	assert(evaluateFilter({ field: "duration", op: "lte", value: 120 }, task));
});

// ── date ops ──
test("date gte", () => {
	assert(evaluateFilter({ field: "date", op: "gte", value: "2026-06-01" }, task));
});
test("date gte no match", () => {
	assert(!evaluateFilter({ field: "date", op: "gte", value: "2026-06-30" }, task));
});
test("date lt", () => {
	assert(evaluateFilter({ field: "date", op: "lt", value: "2026-06-30" }, task));
});
test("date lte equal", () => {
	assert(evaluateFilter({ field: "date", op: "lte", value: "2026-06-24" }, task));
});

// ── compound: and ──
test("and both true", () => {
	const filter = {
		op: "and",
		filters: [
			{ field: "bucket", op: "eq", value: "deep-work" },
			{ field: "duration", op: "gte", value: 30 },
		],
	};
	assert(evaluateFilter(filter, task));
});
test("and one false", () => {
	const filter = {
		op: "and",
		filters: [
			{ field: "bucket", op: "eq", value: "other" },
			{ field: "duration", op: "gte", value: 30 },
		],
	};
	assert(!evaluateFilter(filter, task));
});

// ── compound: or ──
test("or one true", () => {
	const filter = {
		op: "or",
		filters: [
			{ field: "bucket", op: "eq", value: "nonexistent" },
			{ field: "duration", op: "gte", value: 30 },
		],
	};
	assert(evaluateFilter(filter, task));
});
test("or all false", () => {
	const filter = {
		op: "or",
		filters: [
			{ field: "bucket", op: "eq", value: "nonexistent" },
			{ field: "duration", op: "gte", value: 200 },
		],
	};
	assert(!evaluateFilter(filter, task));
});

// ── compound: not ──
test("not flips true→false", () => {
	assert(!evaluateFilter({ op: "not", filter: { field: "bucket", op: "exists" } }, task));
});
test("not flips false→true", () => {
	assert(evaluateFilter({ op: "not", filter: { field: "priority", op: "exists" } }, task));
});

// ── nested compound ──
test("nested and inside or", () => {
	const filter = {
		op: "or",
		filters: [
			{ field: "bucket", op: "eq", value: "impossible" },
			{
				op: "and",
				filters: [
					{ field: "duration", op: "gte", value: 60 },
					{ field: "duration", op: "lte", value: 120 },
				],
			},
		],
	};
	assert(evaluateFilter(filter, task));
});

// ── null/edge cases ──
test("null filter passes all", () => {
	assert(evaluateFilter(null, task));
});
test("undefined filter passes all", () => {
	assert(evaluateFilter(undefined, task));
});

// ── empty string on text field ──
test("contains on empty task", () => {
	const emptyTask = { ...task, cleanText: "" };
	assert(!evaluateFilter({ field: "text", op: "contains", value: "anything" }, emptyTask));
});

// ── exists on empty string field ──
test("exists on empty string returns false", () => {
	const t = { ...task, cleanText: "" };
	assert(!evaluateFilter({ field: "text", op: "exists" }, t));
});

// ── status field ──
test("status eq", () => {
	assert(evaluateFilter({ field: "status", op: "eq", value: " " }, task));
});
test("status eq done returns false", () => {
	assert(!evaluateFilter({ field: "status", op: "eq", value: "x" }, task));
});

// ── Summary ──
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail > 0) {
	process.exit(1);
} else {
	console.log("✅ All filter-engine tests pass");
}
