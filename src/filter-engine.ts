/**
 * filter-engine — Pure-logic filter predicates and evaluation.
 * No Obsidian dependencies. Filters are plain objects that match task objects.
 *
 * Leaf filter:  { field, op, value? }
 * Compound:     { op: "and"|"or", filters: [...] }
 *               { op: "not", filter: subFilter }
 */

import type { FilterConfig, FilterOp, TaskRow } from "./types";

// ── Filter field definitions (for UI builders) ──

export const FILTER_FIELDS = [
  { id: "bucket", label: "Bucket", type: "string", options: "fromBuckets" as const },
  { id: "project", label: "Project", type: "string" },
  { id: "priority", label: "Priority", type: "string" },
  { id: "date", label: "Date", type: "date" },
  { id: "status", label: "Status", type: "string", options: ["open", "done"] as const },
  { id: "text", label: "Task Text", type: "string" },
  { id: "duration", label: "Duration", type: "number" },
];

export const FILTER_OPS = [
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
 */
export function getFieldValue(task: TaskRow, field: string): unknown {
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
 * String comparisons (eq / neq) are case-insensitive.
 * Date comparisons are lexicographic (YYYY-MM-DD is sortable).
 */
export function compareValues(fieldValue: unknown, op: FilterOp, filterValue?: string | number): boolean {
  if (op === "exists") return fieldValue !== null && fieldValue !== undefined && fieldValue !== "";
  if (op === "not_exists") return fieldValue === null || fieldValue === undefined || fieldValue === "";

  if (fieldValue === null || fieldValue === undefined) return false;

  switch (op) {
    case "eq": {
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
    case "gt":  return (fieldValue as number) > (filterValue as number);
    case "gte": return (fieldValue as number) >= (filterValue as number);
    case "lt":  return (fieldValue as number) < (filterValue as number);
    case "lte": return (fieldValue as number) <= (filterValue as number);
    default:    return false;
  }
}

// ── Filter evaluation ──

/**
 * Evaluate a single filter (leaf or compound) against a task.
 * Null / undefined filter passes everything.
 */
export function evaluateFilter(filter: FilterConfig | null | undefined, task: TaskRow): boolean {
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

  // Remaining must be a leaf filter — discriminated by "op" not being and/or/not
  const leaf = filter as { field: string; op: FilterOp; value?: string | number };

  if (!leaf.field) return true;

  const fieldValue = getFieldValue(task, leaf.field);

  if (leaf.op === "exists") {
    return fieldValue !== null && fieldValue !== undefined && fieldValue !== "";
  }
  if (leaf.op === "not_exists") {
    return fieldValue === null || fieldValue === undefined || fieldValue === "";
  }

  return compareValues(fieldValue, leaf.op, leaf.value);
}
