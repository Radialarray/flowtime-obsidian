/**
 * Compute budget state from used and total values.
 * Thresholds:
 *   normal:  0 ≤ ratio ≤ 0.79
 *   warning: 0.80 ≤ ratio ≤ 0.99
 *   over:    ratio ≥ 1.0
 *
 * Edge cases:
 *   total <= 0 → { ratio: 0, state: "normal" }
 *   used < 0   → { ratio: 0, state: "normal" }
 */
export function getBudgetState(used: number, total: number): { ratio: number; state: "normal" | "warning" | "over" } {
  if (total <= 0 || used < 0) {
    return { ratio: 0, state: "normal" };
  }

  const ratio = used / total;

  if (ratio >= 1.0) {
    return { ratio, state: "over" };
  }

  if (ratio >= 0.8) {
    return { ratio, state: "warning" };
  }

  return { ratio, state: "normal" };
}

/**
 * Create a progress bar DOM element.
 * @param used - Amount used
 * @param total - Total budget
 * @param label - Optional text, auto-generated if omitted
 * @param contextEl - Optional context element; its ownerDocument is used for popout compatibility
 */
export function renderProgressBar(used: number, total: number, label?: string, contextEl?: HTMLElement): HTMLElement {
  const { ratio, state } = getBudgetState(used, total);
  const pct = Math.min(Math.round(ratio * 100), 100);

  const doc = contextEl?.ownerDocument ?? document;
  const bar = doc.createElement("div");
  bar.className = `ft-progress-bar ft-state-${state}`;

  const fill = doc.createElement("div");
  fill.className = "ft-progress-fill";
  fill.style.width = pct + "%";
  bar.appendChild(fill);

  const text = doc.createElement("span");
  text.className = "ft-progress-label";
  text.textContent = label || `${formatHours(used)} / ${formatHours(total)}h`;
  bar.appendChild(text);

  return bar;
}

/**
 * Format hours for display (1 decimal place, no trailing zero).
 */
export function formatHours(hours: number): string {
  return parseFloat(hours.toFixed(1)).toString();
}
