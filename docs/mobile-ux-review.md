# Flowtime Plugin — Mobile & Responsive UX Review

**Date:** 2026-06-26
**Tested:** iPhone 13 mini (375×812px), iPad (768–1024px), MacBook 14" (~1512px), Desktop 27" (2560px+)

## Executive Summary

Flowtime is a **desktop-first** plugin. The table view — the core UX pattern — is fundamentally incompatible with phone screens. The list view exists and works better but is not the default and has its own mobile issues. Zero responsive breakpoints exist for Flowtime's own UI components; the only responsive code controls Obsidian's editor content width.

---

## Hierarchy

| Issue | Severity | Detail |
|-------|----------|--------|
| Toolbar overflow on mobile | 🔴 Critical | `.ft-toolbar-row` has 6+ controls in one row. At 375px, wraps chaotically into 3–4 lines. No mobile-first toolbar. |
| Timeline grid min-width | 🔴 Critical | `.ft-tg-grid` has `min-width: 760px`. Grid view is completely unusable on phones. |
| Weekplan day header widths | 🟡 High | `.ft-wp-day-label` min-width 140px + `.ft-wp-time` min-width 160px = 300px before task text. |
| Floating editor width | 🟡 High | `min-width: 320px, max-width: 360px`. On 375px screen, takes 85–96% of width. No viewport clamping. |
| Table column count | 🟡 High | Default columns exceed 375px. Horizontal scroll works but task text is invisible until scrolled. |

## Clarity

| Issue | Severity | Detail |
|-------|----------|--------|
| Dense row padding | 🟡 High | 6px vertical padding on table rows. Hard to distinguish rows on mobile. |
| Timer display eats space | 🟡 High | `min-width: 60px` timer display + 48px+44px time inputs. |
| Filter panel width | 🟠 Medium | `min-width: 300px` overflows 375px viewport. |
| Budget bars | 🟠 Medium | `min-width: 250px` on progress bars. |

## Accessibility

| Before | After | Why |
|--------|-------|-----|
| `--checkbox-size: 14px` | `20px` on touch | Below WCAG 2.5.5 minimum. 14px ≈ 3.7mm on iPhone 13 mini |
| Timer buttons `26×26px` | `36×36px` on touch | Below Apple HIG 44pt recommendation |
| `.ft-detail-close` padding `2px 6px`, font-size `14px` | `6px 10px`, `16px` | Close button ~18×22px — below tap target minimum |
| `.ft-fe-cancel`/`.ft-fe-save` font-size `12px` | `var(--font-ui-small)` | 12px below legible threshold on mobile |
| `.ft-col-dd-item` padding `4px 12px` | `8px 14px` on touch | Dropdown items need more vertical padding for fingers |
| No `:focus-visible` styles | Add `outline: 2px solid var(--interactive-accent)` | Keyboard navigation impossible |
| No `@media (hover: hover)` | Wrap all `:hover` rules | iOS sticky hover — first tap triggers hover, needs second tap to activate. Affects 30+ rules |

## Components

### Table View
- Columns overflow on mobile → auto-switch to list view on < 600px
- No scroll shadow hints when content overflows horizontally
- Row padding too dense for touch

### List View
- Row padding too small (6px vertical)
- Drag handle `⠿` non-functional on touch (no `touch-action`, no long-press)
- No swipe actions for complete/reschedule
- Time inputs 48px wide — could be 40px on mobile

### Timeline Grid
- `min-width: 760px` — must be disabled on phones completely
- Drag-to-resize uses `mousedown`/`mousemove` — no touch support
- Grid row height 28px — could be 24px on mobile for more visible rows

### Floating Editor / Popups
- All `position: fixed` elements lack viewport clamping
- `min-width: 320px` on 375px screen leaves 55px total margin
- Source link button `🔗` easy to mis-tap on mobile

### Quick Entry Modal
- Modal handled by Obsidian — works fine on mobile ✓

### Inbox Processor
- Textarea `min-height: 50px` — tight on mobile
- Buttons could stack vertically on mobile

## Responsive Breakpoints

**Current:** Only `max-width: 600px` and `max-width: 1024px` for content width presets. No component-level responsive styles.

**Needed:**
- `< 480px` — phone: auto-list, collapsed toolbar, hide secondary columns
- `480–768px` — phone landscape / small tablet: list default, reduced toolbar
- `768–1024px` — tablet: table works with smart column hiding, grid still hidden
- `> 1024px` — desktop: current behavior

## Missing Patterns

- No `@media (pointer: coarse)` for touch-specific sizing
- No `@media (hover: none)` for sticky hover prevention
- No `touch-action: manipulation` on interactive elements (300ms tap delay)
- No `-webkit-tap-highlight-color: transparent` on tap targets
- No loading skeleton/shimmer during task loading
- Transition durations inconsistent (100ms, 120ms, 150ms, 300ms, 500ms)

## Screen-by-Screen

| Screen | Table | List | Grid | Toolbar | Editor |
|--------|-------|------|------|---------|--------|
| iPhone 13 mini (375px) | ❌ | ⚠️ | ❌ | ❌ | ⚠️ |
| iPhone landscape (812px) | ⚠️ | ✅ | ❌ | ⚠️ | ✅ |
| iPad portrait (768px) | ⚠️ | ✅ | ❌ | ⚠️ | ✅ |
| iPad landscape (1024px) | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| MacBook 14" (1512px) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Desktop 27" (2560px) | ✅ | ✅ | ✅ | ✅ | ✅ |

Legend: ✅ Works | ⚠️ Works with issues | ❌ Broken

## Implementation Priority

### 🔴 Critical
1. Auto-detect mobile and default to list view
2. Disable timeline grid on < 768px
3. Clamp all fixed-position popups to viewport
4. Add `@media (hover: hover)` wrappers to all hover rules

### 🟡 High
5. Responsive toolbar — collapse into overflow menu on < 600px
6. Increase touch targets (checkboxes 20px, timer buttons 36px, row padding 10px)
7. Mobile-first column defaults (check, task, date only)
8. Weekplan time column min-width reduction

### 🟠 Medium
9. Swipe actions on list rows (complete/reschedule)
10. Scroll shadow hints on overflow containers
11. Loading state during task loading
12. Collapse session history table on mobile

### 🟢 Low
13. Unify transition durations to 150ms UI / 300ms reveals
14. Add `touch-action: manipulation` to interactive elements
15. Haptic feedback on checkbox toggle
