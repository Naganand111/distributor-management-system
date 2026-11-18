/**
 * Customer tools: the authenticated customer's own orders, payments,
 * invoices, purchases, spend summary and profile.
 *
 * Every tool filters on `actor.userId`, which the registry populates from the
 * authenticated session. Callers cannot supply or influence identity.
 */

import { AI_ROLE, CUSTOMER_HISTORY_MAX_ROWS, MAX_ROWS } from "../../constants.js";
import { allRows, firstRow } from "../../db.js";
import { PERIODS, PERIOD_NAMES } from "./periods.js";

const CUSTOMER_DEFAULTS = Object.freeze({
  allowedRoles: [AI_ROLE.CUSTOMER],
  readOnly: true,
  maxRows: MAX_ROWS[AI_ROLE.CUSTOMER],
});

const LIMIT_ARG = Object.freeze({
  type: "int",
  default: 5,
  min: 1,
  max: CUSTOMER_HISTORY_MAX_ROWS,
});

const PERIOD_ARG = Object.freeze({
  type: "enum",
  values: PERIOD_NAMES,
  default: "all",
});

/** Resolve the period fragment for a validated enum name. */
function periodFor(args) {
  return PERIODS[args.period] || PERIODS.all;
}

const ORDER_SELECT = `SELECT o.id, o.status, o.payment_status, o.total_amount, o.discount, o.gst,
                o.paid_amount, o.created_at,
                (o.total_amount - COALESCE(o.discount, 0)) AS net_total,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count,
                (SELECT i.invoice_no FROM invoices i WHERE i.order_id=o.id) AS invoice_no
         FROM orders o
         WHERE o.user_id=?`;

export const customerTools = [
  {
    ...CUSTOMER_DEFAULTS,
    name: "get_my_orders",
    intent: "my_orders",
    description: "The authenticated customer's most recent orders, optionally limited and filtered by period.",
    inputSchema: { limit: LIMIT_ARG, period: PERIOD_ARG },
    run: async ({ db, actor, args }) => {
      const period = periodFor(args);

      const orders = await allRows(
        db,
        `${ORDER_SELECT} ${period.sql}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
        [actor.userId, args.limit]
      );

      return { data: { orders, limit: args.limit, period: period.label } };
    },
  },

  {
    ...CUSTOMER_DEFAULTS,
    name: "track_my_latest_order",
    intent: "track_order",
    description: "The authenticated customer's latest order with its line items and status history.",
    inputSchema: {},
    run: async ({ db, actor }) => {
      const orders = await allRows(
        db,
        `${ORDER_SELECT}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT 1`,
        [actor.userId]
      );

      if (!orders.length) return { data: { orders: [] } };

      const orderId = orders[0].id;

      const items = await allRows(
        db,
        `SELECT p.name, oi.quantity, oi.price
         FROM order_items oi
         JOIN products p ON p.id=oi.product_id
         WHERE oi.order_id=?`,
        [orderId]
      );

      const history = await allRows(
        db,
        `SELECT status, note, created_at
         FROM order_status_history
         WHERE order_id=?
         ORDER BY created_at ASC, id ASC`,
        [orderId]
      );

      return { data: { orders, items, history } };
    },
  },

  {
    ...CUSTOMER_DEFAULTS,
    name: "get_my_payments",
    intent: "my_payments",
    description: "The authenticated customer's recent payments plus a paid/outstanding summary across their orders.",
    inputSchema: { limit: LIMIT_ARG },
    run: async ({ db, actor, args }) => {
      const payments = await allRows(
        db,
        `SELECT p.id AS payment_id, p.order_id, p.amount, p.method, p.note,
                p.created_at AS payment_date,
                (SELECT i.invoice_no FROM invoices i WHERE i.order_id=p.order_id) AS invoice_no,
                o.payment_status
         FROM payments p
         JOIN orders o ON o.id=p.order_id
         WHERE o.user_id=?
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ?`,
        [actor.userId, args.limit]
      );

      const summary = await firstRow(
        db,
        `SELECT
           COALESCE(SUM(o.paid_amount), 0) AS paid,
           COALESCE(SUM(GREATEST(o.total_amount - o.paid_amount, 0)), 0) AS outstanding,
           COUNT(*) AS orders,
           COALESCE(SUM(o.status='pending'), 0) AS pending_orders
         FROM orders o
         WHERE o.user_id=? AND o.status != 'cancelled'`,
        [actor.userId]
      );

      return { data: { payments, summary, limit: args.limit } };
    },
  },

  {
    ...CUSTOMER_DEFAULTS,
    name: "get_my_invoices",
    intent: "my_invoices",
    description: "The authenticated customer's recent invoices with an invoice count and total.",
    inputSchema: { limit: LIMIT_ARG },
    run: async ({ db, actor, args }) => {
      const invoices = await allRows(
        db,
        `SELECT i.id, i.invoice_no, i.order_id, i.invoice_date, i.grand_total,
                i.subtotal, i.discount, i.gst_amount, i.payment_status
         FROM invoices i
         JOIN orders o ON o.id=i.order_id
         WHERE o.user_id=?
         ORDER BY i.invoice_date DESC, i.id DESC
         LIMIT ?`,
        [actor.userId, args.limit]
      );

      const summary = await firstRow(
        db,
        `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.grand_total), 0) AS invoiced_total
         FROM invoices i
         JOIN orders o ON o.id=i.order_id
         WHERE o.user_id=?`,
        [actor.userId]
      );

      return { data: { invoices, summary } };
    },
  },

  {
    ...CUSTOMER_DEFAULTS,
    name: "get_my_purchase_history",
    intent: "recent_purchases",
    description:
      "The authenticated customer's non-cancelled purchases with their line items, optionally limited and filtered by period.",
    inputSchema: { limit: LIMIT_ARG, period: PERIOD_ARG },
    run: async ({ db, actor, args }) => {
      const period = periodFor(args);

      const orders = await allRows(
        db,
        `SELECT o.id, o.status, o.payment_status, o.total_amount, o.discount,
                o.created_at,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count
         FROM orders o
         WHERE o.user_id=? AND o.status != 'cancelled' ${period.sql}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
        [actor.userId, args.limit]
      );

      if (!orders.length) return { data: { orders: [], items: {} } };

      const ids = orders.map((o) => o.id);
      const items = await allRows(
        db,
        `SELECT oi.order_id, p.name, oi.quantity, oi.price
         FROM order_items oi
         JOIN products p ON p.id=oi.product_id
         WHERE oi.order_id IN (?)
         ORDER BY oi.order_id DESC`,
        [ids]
      );

      const grouped = {};
      for (const row of items) {
        if (!grouped[row.order_id]) grouped[row.order_id] = [];
        grouped[row.order_id].push({ name: row.name, quantity: row.quantity, price: row.price });
      }

      return { data: { orders, items: grouped, period: period.label } };
    },
  },

  {
    ...CUSTOMER_DEFAULTS,
    name: "get_my_spending_summary",
    intent: "my_order_summary",
    description:
      "The authenticated customer's order counts by status, total spend on non-cancelled orders and date of last order.",
    inputSchema: {},
    run: async ({ db, actor }) => {
      const summary = await firstRow(
        db,
        `SELECT
           COUNT(*) AS total_orders,
           COALESCE(SUM(status='pending'), 0) AS pending,
           COALESCE(SUM(status='processing'), 0) AS processing,
           COALESCE(SUM(status='shipped'), 0) AS shipped,
           COALESCE(SUM(status='delivered'), 0) AS delivered,
           COALESCE(SUM(status='cancelled'), 0) AS cancelled,
           COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount - discount ELSE 0 END), 0) AS total_spent,
           MAX(created_at) AS last_order_at
         FROM orders
         WHERE user_id=?`,
        [actor.userId]
      );

      return { data: { summary } };
    },
  },

  {
    ...CUSTOMER_DEFAULTS,
    name: "get_my_profile",
    intent: "my_profile",
    description: "The authenticated customer's own account details: name, contact, city and state.",
    inputSchema: {},
    run: async ({ db, actor }) => {
      const row = await firstRow(
        db,
        `SELECT name, email, mobile, city, state, role
         FROM users
         WHERE id=? AND role='customer'`,
        [actor.userId]
      );

      return { data: { profile: row || null } };
    },
  },
];