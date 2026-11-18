/**
 * Admin tools: revenue, growth and profit queries.
 */

import { ADMIN_TOOL_DEFAULTS, allRows, firstRow } from "./helpers.js";

const single = (name, intent, description, sql) => ({
  ...ADMIN_TOOL_DEFAULTS,
  name,
  intent,
  description,
  run: async ({ db }) => ({ data: await firstRow(db, sql) }),
});

const THIS_MONTH_WHERE = `WHERE MONTH(created_at) = MONTH(NOW())
      AND YEAR(created_at) = YEAR(NOW())
      AND status != 'cancelled'`;

const LAST_MONTH_WHERE = `WHERE MONTH(created_at) = MONTH(NOW() - INTERVAL 1 MONTH)
      AND YEAR(created_at) = YEAR(NOW() - INTERVAL 1 MONTH)
      AND status != 'cancelled'`;

export const adminTrendTools = [
  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "get_sales_trend",
    intent: "sales_trend",
    description:
      "Daily revenue and order-count trend across recorded days in the last 30 days, including first/latest/best day totals and a sufficiency flag.",
    run: async ({ db }) => {
      /* Only days that actually have recorded orders. Missing dates are
         never inserted as zero rows. */
      const TREND_WINDOW_DAYS = 30;
      const TREND_MIN_DAYS = 3;
      const since = new Date(Date.now() - TREND_WINDOW_DAYS * 86400000);

      const rows = await allRows(
        db,
        `SELECT DATE(created_at) AS day,
                COUNT(*) AS orders,
                COALESCE(SUM(total_amount - discount), 0) AS revenue
         FROM orders
         WHERE status != 'cancelled' AND created_at >= ?
         GROUP BY DATE(created_at)
         ORDER BY day ASC`,
        [since]
      );

      const days = rows.map((r) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      }));

      const data = {
        recorded_days: days.length,
        window_days: TREND_WINDOW_DAYS,
        sufficient: days.length >= TREND_MIN_DAYS,
        days: days.slice(-7).reverse(),
      };

      if (!data.sufficient) {
        data.insufficient = true;
        return { data };
      }

      const first = days[0];
      const latest = days[days.length - 1];
      const best = days.reduce((a, b) => (b.revenue > a.revenue ? b : a), days[0]);

      data.total_revenue = days.reduce((sum, r) => sum + r.revenue, 0);
      data.total_orders = days.reduce((sum, r) => sum + r.orders, 0);
      data.first_day = first.day;
      data.first_revenue = first.revenue;
      data.latest_day = latest.day;
      data.latest_revenue = latest.revenue;
      data.best_day = best.day;
      data.best_revenue = best.revenue;

      return { data };
    },
  },

  single(
    "get_total_revenue",
    "total_revenue",
    "All-time order count and revenue across every non-cancelled order.",
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_amount - discount), 0) AS revenue
     FROM orders
     WHERE status != 'cancelled'`
  ),

  single(
    "get_this_month_revenue",
    "this_month_revenue",
    "Current calendar month's revenue and order count, excluding cancelled orders.",
    `SELECT COALESCE(SUM(total_amount - discount), 0) AS revenue,
            COUNT(*) AS orders
     FROM orders
     ${THIS_MONTH_WHERE}`
  ),

  single(
    "get_last_month_revenue",
    "last_month_revenue",
    "Previous calendar month's revenue and order count, excluding cancelled orders.",
    `SELECT COALESCE(SUM(total_amount - discount), 0) AS revenue,
            COUNT(*) AS orders
     FROM orders
     ${LAST_MONTH_WHERE}`
  ),

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "compare_months",
    intent: "compare_months",
    description: "This month's revenue and order count beside last month's, for month-over-month comparison.",
    run: async ({ db }) => {
      const thisMonth = await firstRow(
        db,
        `SELECT COALESCE(SUM(total_amount - discount), 0) AS revenue,
                COUNT(*) AS orders
         FROM orders
         ${THIS_MONTH_WHERE}`
      );

      const lastMonth = await firstRow(
        db,
        `SELECT COALESCE(SUM(total_amount - discount), 0) AS revenue,
                COUNT(*) AS orders
         FROM orders
         ${LAST_MONTH_WHERE}`
      );

      return { data: { thisMonth, lastMonth } };
    },
  },

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "get_gross_profit",
    intent: "gross_profit",
    description: "Gross profit on delivered orders: item revenue, cost of goods, profit and margin percentage.",
    run: async ({ db }) => {
      const rev = await firstRow(
        db,
        `SELECT COALESCE(SUM(oi.price * oi.quantity), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'`
      );

      const cost = await firstRow(
        db,
        `SELECT COALESCE(SUM(p.purchase_price * oi.quantity), 0) AS cost
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'`
      );

      const revenue = Number(rev.revenue);
      const totalCost = Number(cost.cost);
      const profit = revenue - totalCost;
      const margin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0;

      return {
        data: {
          revenue,
          cost: totalCost,
          profit,
          margin: Number(margin),
        },
      };
    },
  },

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "get_sales_rep_performance",
    intent: "sales_rep_performance",
    description:
      "Order count and revenue per sales representative, matched by representative name, ranked by revenue.",
    maxRows: 5,
    run: async ({ db }) => ({
      data: await allRows(
        db,
        `SELECT sr.name,
                COUNT(o.id) AS orders,
                COALESCE(SUM(o.total_amount - o.discount), 0) AS revenue
         FROM orders o
         JOIN sales_representatives sr
           ON sr.name = o.salesman
         WHERE o.status != 'cancelled'
           AND o.salesman IS NOT NULL
           AND TRIM(o.salesman) <> ''
         GROUP BY sr.id, sr.name
         ORDER BY revenue DESC
         LIMIT 5`
      ),
    }),
  },
];