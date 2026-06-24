/**
 * filter-engine.js — Pure-logic filter predicates and evaluation
 *
 * No Obsidian dependencies. Filters are plain objects that match task objects.
 *
 * Leaf filter:  { field, op, value? }
 * Compound:     { op: "and"|"or", filters: [...] }
 *               { op: "not", filter: subFilter }
 */

// ── Filter field definitions (for UI builders) ──

const FILTER_FIELDS = [
	{ id: "bucket", label: "Bucket", type: "string", options: "fromBuckets" },
	{ id: "project", label: "Project", type: "string" },
	{ id: "priority", label: "Priority", type: "string" },
	{ id: "date", label: "Date", type: "date" },
	{ id: "status", label: "Status", type: "string", options: ["open", "done"] },
	{ id: "text", label: "Task Text", type: "string" },
	{ id: "duration", label: "Duration", type: "number" },
];

const FILTER_OPS = [
	{ id: "eq", label: "is" },
	{ id: "neq", label: "is not" },
	{ id: "contains", label: "contains" },
	{ id: "gt", label: ">" },
	{ id: "gte", label: "≥" },
	{ id: "lt", label: "<" },
	{ id: "lte", label: "≤" },
	{ id: "exists", label: "exists" },
	{ id: "not_exists", label: "does not exist" },
];

// ── Field value extraction ──

/**
 * Get the value of a named field from a task object.
 * Normalises field aliases ("date" → taskDate, "text" → cleanText, "duration" → durationMinutes).
 *
 * @param {object} task
 * @param {string} field
 * @returns {*}
 */
function getFieldValue(task, field) {
	switch (field) {
		case "bucket":   return task.bucket;
		case "project":  return task.project;
		case "priority": return task.priority;
		case "date":     return task.taskDate;
		case "status":   return task.status;
		case "text":     return task.cleanText;
		case "duration": return task.durationMinutes;
		default:         return null;
	}
}

// ── Value comparison ──

/**
 * Compare a field value against a filter value using the given operator.
 *
 * String comparisons (eq / neq) are case-insensitive.
 * Numeric comparisons coerce both sides to numbers for duration.
 * Date comparisons are lexicographic (YYYY-MM-DD is sortable).
 *
 * @param {*} fieldValue   Value extracted from the task
 * @param {string} op      Operator id
 * @param {*} filterValue  Value from the filter definition
 * @returns {boolean}
 */
function compareValues(fieldValue, op, filterValue) {
	// exists / not_exists are handled before this function is called,
	// but guard here for safety.
	if (op === "exists") return fieldValue !== null && fieldValue !== undefined && fieldValue !== "";
	if (op === "not_exists") return fieldValue === null || fieldValue === undefined || fieldValue === "";

	if (fieldValue === null || fieldValue === undefined) return false;

	switch (op) {
		case "eq": {
			// Case-insensitive string comparison; else strict equality for numbers
			if (typeof fieldValue === "string" && typeof filterValue === "string") {
				return fieldValue.toLowerCase() === filterValue.toLowerCase();
			}
			return fieldValue === filterValue;
		}
		case "neq": {
			if (typeof fieldValue === "string" && typeof filterValue === "string") {
				return fieldValue.toLowerCase() !== filterValue.toLowerCase();
			}
			return fieldValue !== filterValue;
		}
		case "contains": {
			if (typeof fieldValue !== "string") return false;
			return fieldValue.toLowerCase().includes(String(filterValue).toLowerCase());
		}
		case "gt":
			return fieldValue > filterValue;
		case "gte":
			return fieldValue >= filterValue;
		case "lt":
			return fieldValue < filterValue;
		case "lte":
			return fieldValue <= filterValue;
		default:
			return false;
	}
}

// ── Filter evaluation ──

/**
 * Evaluate a single filter (leaf or compound) against a task.
 *
 * @param {object|null|undefined} filter
 * @param {object} task
 * @returns {boolean}
 */
function evaluateFilter(filter, task) {
	// Null / undefined filter passes everything (no filter = show all)
	if (!filter) return true;

	// Compound: "and"
	if (filter.op === "and") {
		if (!Array.isArray(filter.filters)) return true;
		return filter.filters.every((sub) => evaluateFilter(sub, task));
	}

	// Compound: "or"
	if (filter.op === "or") {
		if (!Array.isArray(filter.filters)) return true;
		return filter.filters.some((sub) => evaluateFilter(sub, task));
	}

	// Compound: "not"
	if (filter.op === "not") {
		return !evaluateFilter(filter.filter, task);
	}

	// Leaf filter: must have a field
	if (!filter.field) return true;

	const fieldValue = getFieldValue(task, filter.field);

	// Handle exists / not_exists at the top level
	if (filter.op === "exists") {
		return fieldValue !== null && fieldValue !== undefined && fieldValue !== "";
	}
	if (filter.op === "not_exists") {
		return fieldValue === null || fieldValue === undefined || fieldValue === "";
	}

	return compareValues(fieldValue, filter.op, filter.value);
}

module.exports = {
	evaluateFilter,
	getFieldValue,
	compareValues,
	FILTER_FIELDS,
	FILTER_OPS,
};
