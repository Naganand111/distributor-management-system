/**
 * Canonical LOW STOCK / REORDER threshold rule.
 *
 * `products` carries two threshold columns:
 *   - `reorder_level`    : explicit reorder policy (0 / NULL when not configured)
 *   - `min_stock_level`  : low-stock alert threshold
 *
 * A product is flagged as LOW STOCK when its stock has reached the effective
 * threshold, which is the configured `reorder_level` when one exists and
 * `min_stock_level` otherwise. NULL / 0 thresholds never mean "always low".
 *
 * Every backend surface (products list, low-stock list, analytics, reports,
 * reorder suggestions, Admin AI) must use these helpers so a product is
 * classified identically everywhere.
 */

/** Effective threshold expression, e.g. `COALESCE(NULLIF(p.reorder_level, 0), p.min_stock_level, 0)` */
export function effectiveThresholdSql(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `COALESCE(NULLIF(${p}reorder_level, 0), ${p}min_stock_level, 0)`;
}

/** `1` when the product has reached its effective threshold, otherwise `0`. */
export function isLowStockSql(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `CASE WHEN ${p}stock <= ${effectiveThresholdSql(alias)} THEN 1 ELSE 0 END`;
}

/** `WHERE ...` predicate matching LOW STOCK, alias aware. */
export const LOW_STOCK_PREDICATE = (alias = "") =>
  `${alias ? `${alias}.` : ""}stock <= ${effectiveThresholdSql(alias)}`;