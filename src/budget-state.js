/**
 * Compute budget state from used and total values.
 * @param {number} used - Amount used (e.g., hours scheduled)
 * @param {number} total - Total budget (e.g., weekly limit in hours)
 * @returns {{ ratio: number, state: 'normal'|'warning'|'over' }}
 *
 * Thresholds (hardcoded, documented):
 *   normal:  0 ≤ ratio ≤ 0.79
 *   warning: 0.80 ≤ ratio ≤ 0.99
 *   over:    ratio ≥ 1.0
 *
 * Edge cases:
 *   - total <= 0 → { ratio: 0, state: 'normal' }
 *   - used < 0   → { ratio: 0, state: 'normal' }
 */
function getBudgetState(used, total) {
	if (total <= 0 || used < 0) {
		return { ratio: 0, state: 'normal' };
	}

	const ratio = used / total;

	if (ratio >= 1.0) {
		return { ratio, state: 'over' };
	}

	if (ratio >= 0.8) {
		return { ratio, state: 'warning' };
	}

	return { ratio, state: 'normal' };
}

/**
 * Create a progress bar DOM element.
 * @param {number} used - Amount used
 * @param {number} total - Total budget
 * @param {string} [label] - Optional text like "14.2 / 20h" (auto-generated if omitted)
 * @returns {HTMLElement} A div with class ft-progress-bar and appropriate state class
 */
function renderProgressBar(used, total, label) {
	const { ratio, state } = getBudgetState(used, total);
	const pct = Math.min(Math.round(ratio * 100), 100);

	const bar = document.createElement("div");
	bar.className = `ft-progress-bar ft-state-${state}`;

	const fill = document.createElement("div");
	fill.className = "ft-progress-fill";
	fill.style.width = pct + "%";
	bar.appendChild(fill);

	const text = document.createElement("span");
	text.className = "ft-progress-label";
	text.textContent = label || `${formatHours(used)} / ${formatHours(total)}h`;
	bar.appendChild(text);

	return bar;
}

/**
 * Format hours for display (1 decimal place, no trailing zero).
 * @param {number} hours
 * @returns {string}
 */
function formatHours(hours) {
	return parseFloat(hours.toFixed(1)).toString();
}

module.exports = { getBudgetState, renderProgressBar, formatHours };
