/**
 * Canonical ORDER money + lifecycle rules.
 *
 * Storage contract used by every order surface:
 *   orders.total_amount : line-item SUBTOTAL, excluding discount and GST
 *   orders.discount     : discount applied to the subtotal (promotion / loyalty / admin)
 *   orders.gst          : tax on the post-discount taxable amount
 *   amount due          : total_amount - discount + gst
 *
 * This matches the existing DMS reporting convention (revenue is
 * `SUM(total_amount - discount)`, i.e. net of discount and net of tax) and the
 * `invoices` table design (`subtotal - discount = taxable_amount`,
 * `grand_total = taxable_amount + gst_amount`).
 *
 * The GST rate is the project's existing rule (18% of the post-discount
 * taxable amount, rounded to 2 decimals). It is defined server-side here so no
 * request body value can influence the amount a customer is charged.
 *
 * HISTORICAL ROWS ARE NEVER REWRITTEN. Orders written before this contract
 * stored GST inside `total_amount` (or stored no tax at all). They are
 * detected with `classifyTotalsBasis` and reported with their stored figures
 * plus a `totals_basis` label, so historical financial data stays exactly as
 * recorded while no surface invents a new amount for it.
 */

/** Existing project GST rule: 18% of the post-discount taxable amount. */
export const ORDER_GST_RATE = 0.18;

/**
 * The rate as a percentage, i.e. the value stored in `invoice_items.gst_percent`.
 * Invoice lines must state the rate that was actually charged; the project's
 * `products.gst_percent` column is 0 for every product and is left untouched
 * (reconciling product master tax data is invoice-phase work, not order work).
 */
export const APPLIED_GST_PERCENT = roundMoney(ORDER_GST_RATE * 100);

/**
 * How a stored order's money relates to the contract above.
 *
 * Historical rows in this database were written by code that folded GST into
 * `total_amount` (and, even earlier, wrote no tax at all). Those rows are never
 * rewritten: they are reported exactly as recorded and labelled, so no surface
 * can silently re-price historical financial data.
 */
export const TOTALS_BASIS = {
  /** Stored `gst` is exactly 18% of (total_amount - discount). */
  CONTRACT: "contract",
  /** Stored `gst` is 18% of (total_amount - discount) divided by 1.18, i.e. tax was already inside `total_amount`. */
  GST_INCLUDED_IN_TOTAL: "gst_included_in_total_amount",
  /** No tax was recorded at all (pre-tax era orders). */
  NO_TAX_RECORDED: "no_tax_recorded",
  /** Tax recorded that matches neither signature. */
  UNCLASSIFIED: "unclassified_tax_difference",
};

/** `orders.total_amount` is DECIMAL(10,2) -> 99,999,999.99 is the hard ceiling. */
export const MAX_ORDER_SUBTOTAL = 99999999.99;
export const MAX_ITEM_QUANTITY = 100000;
export const MAX_ORDER_LINES = 200;
export const MAX_ORDER_ID = 2147483647;

/** `orders.status` enum. */
export const ORDER_STATUSES = [
  "pending",
  "processing",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
];

/** `orders.payment_status` enum. */
export const PAYMENT_STATUSES = [
  "pending",
  "unpaid",
  "partially_paid",
  "paid",
];

/** Statuses a customer may still cancel before the order ships. */
export const CANCELLABLE_STATUSES = ["pending", "processing", "confirmed"];

/** Allowed status transitions. Terminal states have no outgoing edges. */
export const STATUS_TRANSITIONS = {
  pending: ["processing", "confirmed", "cancelled"],
  processing: ["shipped", "confirmed", "cancelled"],
  confirmed: ["shipped", "delivered", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

/** Round to 2 decimals without float drift (money is stored as DECIMAL). */
export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Authoritative order money calculation.
 * Discount is clamped to [0, subtotal] exactly like the existing checkout
 * rule, so a discount can never make an order total negative.
 */
export function computeOrderTotals(subtotal, discount = 0) {
  const sub = roundMoney(subtotal);
  const disc = roundMoney(Math.min(Math.max(Number(discount) || 0, 0), sub));
  const taxable = roundMoney(sub - disc);
  const gst = roundMoney(taxable * ORDER_GST_RATE);
  return {
    subtotal: sub,
    discount: disc,
    taxableAmount: taxable,
    gst,
    grandTotal: roundMoney(taxable + gst),
  };
}

/**
 * Classify a stored order against the storage contract, using only the stored
 * columns. Two signatures are checked, both of which are exactly satisfied by
 * the historical rows in this database:
 *
 *   contract              gst == round((total_amount - discount) * 0.18)
 *   gst_included_in_total gst == round((total_amount - discount) / 1.18 * 0.18)
 */
export function classifyTotalsBasis(order = {}) {
  const subtotal = roundMoney(order.total_amount);
  const discount = roundMoney(
    Math.min(Math.max(Number(order.discount) || 0, 0), subtotal)
  );
  const storedGst = roundMoney(order.gst);
  const netOfDiscount = roundMoney(subtotal - discount);

  // Differences are compared after rounding so a 1-paise rounding difference is
  // never mistaken for a different calculation basis (binary floats make
  // 18.01 - 18 evaluate to slightly more than 0.01).
  const withinPaise = (a, b) => roundMoney(Math.abs(a - b)) <= 0.01;

  if (withinPaise(storedGst, roundMoney(netOfDiscount * ORDER_GST_RATE))) {
    return TOTALS_BASIS.CONTRACT;
  }

  if (storedGst > 0) {
    const impliedTaxable = roundMoney(netOfDiscount / (1 + ORDER_GST_RATE));
    if (withinPaise(storedGst, roundMoney(impliedTaxable * ORDER_GST_RATE))) {
      return TOTALS_BASIS.GST_INCLUDED_IN_TOTAL;
    }
    return TOTALS_BASIS.UNCLASSIFIED;
  }

  return TOTALS_BASIS.NO_TAX_RECORDED;
}

/**
 * Amounts for a stored order.
 *
 * Contract-basis orders are recalculated from the stored subtotal and discount.
 * Legacy orders are reported exactly as recorded: the stored `gst` and the
 * stored `total_amount` as the payable amount, because that is the figure the
 * customer was charged and (for 34/35/36) the figure captured in `paid_amount`.
 * Nothing is re-priced and nothing is written back.
 */
export function amountsFromOrder(order = {}) {
  const basis = classifyTotalsBasis(order);
  const subtotal = roundMoney(order.total_amount);
  const discount = roundMoney(
    Math.min(Math.max(Number(order.discount) || 0, 0), subtotal)
  );

  if (basis === TOTALS_BASIS.CONTRACT) {
    return { ...computeOrderTotals(subtotal, discount), basis };
  }

  const storedGst = roundMoney(order.gst);
  const netOfDiscount = roundMoney(subtotal - discount);
  const taxableAmount =
    basis === TOTALS_BASIS.GST_INCLUDED_IN_TOTAL
      ? roundMoney(netOfDiscount / (1 + ORDER_GST_RATE))
      : netOfDiscount;

  return {
    subtotal,
    discount,
    taxableAmount,
    gst: storedGst,
    grandTotal: subtotal,
    basis,
  };
}

/**
 * API payload for an order row: the stored columns plus the server-calculated
 * amounts, in the same snake_case shape the order-creation response uses.
 * `totals_basis` tells the UI whether the figures follow the current contract
 * or are historical values preserved as recorded.
 */
export function orderTotalsPayload(order = {}) {
  const t = amountsFromOrder(order);
  const paid = roundMoney(order.paid_amount);
  return {
    subtotal: t.subtotal,
    discount: t.discount,
    taxable_amount: t.taxableAmount,
    gst: t.gst,
    grand_total: t.grandTotal,
    amount_due: roundMoney(Math.max(0, t.grandTotal - paid)),
    gst_rate: ORDER_GST_RATE,
    totals_basis: t.basis,
    is_legacy_totals: t.basis !== TOTALS_BASIS.CONTRACT,
  };
}

/** `payment_status` is always derived from money actually received. */
export function paymentStatusFor(paidAmount, grandTotal) {
  const paid = roundMoney(paidAmount);
  const due = roundMoney(grandTotal);
  if (due > 0 && paid >= due) return "paid";
  if (paid > 0) return "partially_paid";
  return "unpaid";
}

/** Route/param id guard: rejects "1 OR 1=1", "1.5", "-1", "abc", null. */
export function isValidOrderId(value) {
  const n = Number(value);
  return (
    Number.isInteger(n) && n > 0 && n <= MAX_ORDER_ID && String(value).trim() !== ""
  );
}

/**
 * Validate and merge the submitted cart lines.
 * Duplicate product ids are aggregated so stock is checked and deducted once
 * per product, and so a client cannot smuggle the same product in twice to
 * bypass a per-line quantity limit.
 * Any `price` sent by the client is ignored: prices come from the database.
 * Throws an Error carrying a 400-safe message on invalid input.
 */
export function normalizeOrderLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderValidationError("Cart is empty");
  }
  if (items.length > MAX_ORDER_LINES) {
    throw new OrderValidationError(
      `An order cannot contain more than ${MAX_ORDER_LINES} different products`
    );
  }

  const lines = new Map();

  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new OrderValidationError(`Invalid item at position ${index + 1}`);
    }

    const productId = Number(item.id);
    if (!isValidOrderId(item.id) || productId !== Number(item.id)) {
      throw new OrderValidationError(`Invalid product id at position ${index + 1}`);
    }

    const quantity = Number(item.quantity);
    if (
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > MAX_ITEM_QUANTITY
    ) {
      throw new OrderValidationError(
        `Invalid quantity for product ${productId}: must be a whole number between 1 and ${MAX_ITEM_QUANTITY}`
      );
    }

    const existing = lines.get(productId);
    if (existing) {
      existing.quantity += quantity;
      if (existing.quantity > MAX_ITEM_QUANTITY) {
        throw new OrderValidationError(
          `Total quantity for product ${productId} exceeds the maximum of ${MAX_ITEM_QUANTITY}`
        );
      }
    } else {
      lines.set(productId, { productId, quantity });
    }
  }

  return [...lines.values()].sort((a, b) => a.productId - b.productId);
}

/** 400-class error: a bad request, never a 500. */
export class OrderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderValidationError";
    this.status = 400;
  }
}

/** 403-class error: authenticated but not allowed. */
export class OrderForbiddenError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "OrderForbiddenError";
    this.status = 403;
  }
}
