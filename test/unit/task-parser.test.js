const { parseTaskLine, cleanTaskText, buildTaskTree, flattenTree, taskId } = require("../../src/task-parser");
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

// ── v0.6.0: Subtask indent tests ──

const tt1 = parseTaskLine("- [ ] Root", file, 0);
assert(tt1.indent === 0, `Expected indent=0, got ${tt1.indent}`);

const tt2 = parseTaskLine("  - [ ] Child", file, 1);
assert(tt2.indent === 2, `Expected indent=2, got ${tt2.indent}`);

const tt3 = parseTaskLine("    - [ ] Grandchild", file, 2);
assert(tt3.indent === 4, `Expected indent=4, got ${tt3.indent}`);

const tt4 = parseTaskLine("\t- [ ] Tab-indented", file, 3);
assert(tt4.indent === 1, `Expected indent=1, got ${tt4.indent}`); // tab = 1 char

// buildTaskTree - basic hierarchy
const treeTasks = [
  parseTaskLine("- [ ] Root", file, 0),
  parseTaskLine("  - [ ] Child A", file, 1),
  parseTaskLine("    - [ ] Grandchild", file, 2),
  parseTaskLine("  - [ ] Child B", file, 3),
].filter(Boolean);

const tree = buildTaskTree(treeTasks);
assert(tree.length === 1, `Expected 1 root, got ${tree.length}`);
assert(tree[0].depth === 0, `Root depth should be 0, got ${tree[0].depth}`);
assert(tree[0].children.length === 2, `Expected 2 children, got ${tree[0].children.length}`);
assert(tree[0].children[0].children.length === 1, `Child A should have 1 grandchild`);
assert(tree[0].children[0].children[0].depth === 2, `Grandchild depth should be 2`);

// flattenTree - all expanded
const flat = flattenTree(tree);
assert(flat.length === 4, `Expected 4 items, got ${flat.length}`);
assert(flat[0].depth === 0 && flat[0].hasChildren === true, `Root should be depth=0 with children`);
assert(flat[1].depth === 1 && flat[1].hasChildren === true, `Child A should be depth=1`);
assert(flat[2].depth === 2 && flat[2].hasChildren === false, `Grandchild should be depth=2`);
assert(flat[3].depth === 1 && flat[3].hasChildren === false, `Child B should be depth=1`);

// flattenTree - collapsed parent
const collapsedSet = new Set([taskId(treeTasks[1])]); // collapse Child A
const flatCollapsed = flattenTree(tree, collapsedSet);
assert(flatCollapsed.length === 3, `Expected 3 items (Child A collapsed hides grandchild), got ${flatCollapsed.length}`);
assert(flatCollapsed[1].collapsed === true, `Child A should be collapsed`);

// flattenTree - childrenTasks for progress
const flat2 = flattenTree(tree);
assert(flat2[0].childrenTasks.length === 2, `Root childrenTasks should be 2`);
assert(flat2[1].childrenTasks.length === 1, `Child A childrenTasks should be 1`);

// taskId format
const idTask = parseTaskLine("- [ ] Test", { path: "my/file.md" }, 42);
const id = taskId(idTask);
assert(id === "my/file.md:42", `Expected 'my/file.md:42', got '${id}'`);

// Two roots at indent 0
const twoRoots = [
  parseTaskLine("- [ ] Root A", file, 0),
  parseTaskLine("- [ ] Root B", file, 1),
].filter(Boolean);
const tree2 = buildTaskTree(twoRoots);
assert(tree2.length === 2, `Expected 2 roots, got ${tree2.length}`);

console.log("✅ All v0.6.0 subtask tests pass");
console.log("✅ All task-parser tests pass");
