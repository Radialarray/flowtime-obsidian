const { parseTaskLine, cleanTaskText } = require("../../src/task-parser");
const assert = require("assert");

// Mock file object
const file = { path: "test.md" };

// Test bucket parsing
const t1 = parseTaskLine("- [ ] Write spec @bucket:deep-work", file, 0);
assert(t1.bucket === "deep-work", `Expected deep-work, got ${t1.bucket}`);

const t2 = parseTaskLine("- [ ] Meeting @b:meetings", file, 0);
assert(t2.bucket === "meetings", `Expected meetings, got ${t2.bucket}`);

const t3 = parseTaskLine("- [ ] No bucket here", file, 0);
assert(t3.bucket === null, `Expected null, got ${t3.bucket}`);

// Test cleaning strips bucket directive
const cleaned = cleanTaskText("Write spec @bucket:deep-work");
assert(!cleaned.includes("@bucket:"), `Bucket directive not stripped: ${cleaned}`);
assert(cleaned === "Write spec", `Expected 'Write spec', got '${cleaned}'`);

// Test cleaning strips @b short form too
const cleaned2 = cleanTaskText("Quick chat @b:standup with team");
assert(!cleaned2.includes("@b:"), `Short bucket directive not stripped: ${cleaned2}`);
assert(cleaned2 === "Quick chat with team", `Expected 'Quick chat with team', got '${cleaned2}'`);

// Test duration parsing: @1.5h
const t4 = parseTaskLine("- [ ] Task @1.5h", file, 0);
assert(t4.durationMinutes === 90, `Expected 90, got ${t4.durationMinutes}`);

// Test duration parsing: @30m
const t5 = parseTaskLine("- [ ] Task @30m", file, 0);
assert(t5.durationMinutes === 30, `Expected 30, got ${t5.durationMinutes}`);

// Test no duration
const t6 = parseTaskLine("- [ ] Task without dur", file, 0);
assert(t6.durationMinutes === 0, `Expected 0, got ${t6.durationMinutes}`);

// Test cleaning strips duration
const cleaned3 = cleanTaskText("Task @1.5h @30m");
assert(!cleaned3.includes("@1.5h"), `Duration not stripped: ${cleaned3}`);
assert(cleaned3 === "Task", `Expected 'Task', got '${cleaned3}'`);

console.log("✅ All task-parser tests pass");
