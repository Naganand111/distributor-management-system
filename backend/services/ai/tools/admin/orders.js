/**
 * Admin tools: order-status, sales-day, customer-count and retailer queries.
 */

import { ADMIN_TOOL_DEFAULTS, allRows, firstRow } from "./helpers.js";

const single = (name, intent, description, sql) => ({
  ...ADMIN_TOOL_DEFAULTS,
  name,
  intent,
  description,
  run: async ({ db }) => ({ data: await firstRow(db, sql) }),
});

export const adminOrderTools = [
  single(
    "count_pending_orders",
    "pending_orders",
    "Count of orders still in pending status.",
    `SELECT COUNT(*) AS count
     FROM orders
     WHERE status = 'pending'`
  ),

  single(
    "count_cancelled_orders",
    "cancelled_orders",
    "Count of cancelled orders.",
    `SELECT COUNT(*) AS count
     FROM orders
     WHERE status = 'cancelled'`
  ),

  single(
    "count_todays_orders",
    "todays_orders",
    "Count of orders created today, including cancelled orders.",
    `SELECT COUNT(*) AS count
     FROM orders
     WHERE DATE(created_at) = CURDATE()`
  ),

  single(
    "count_total_orders",
    "total_orders",
    "Total number of orders in the system.",
    `SELECT COUNT(*) AS count FROM orders`
  ),

  single(
    "get_overdue_exposure",
    "overdue",
    "Count of unpaid orders and total outstanding amount including GST.",
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(total_amount - discount + gst - paid_amount), 0) AS outstanding
     FROM orders
     WHERE payment_status IN ('pending', 'partially_paid', 'unpaid')
       AND status != 'cancelled'`
  ),

  single(
    "get_todays_sales",
    "todays_sales",
    "Today's order count and revenue, excluding cancelled orders.",
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_amount - discount), 0) AS revenue
     FROM orders
     WHERE DATE(created_at) = CURDATE()
       AND status != 'cancelled'`
  ),

  single(
    "get_yesterdays_sales",
    "yesterday_sales",
    "Yesterday's order count and revenue, excluding cancelled orders.",
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_amount - discount), 0) AS revenue
     FROM orders
     WHERE DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
       AND status != 'cancelled'`
  ),

  single(
    "get_this_week_sales",
    "this_week_sales",
    "This calendar week's (Monday through now) order count and revenue, excluding cancelled orders.",
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_amount - discount), 0) AS revenue
     FROM orders
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
       AND status != 'cancelled'`
  ),

  single(
    "get_last_week_sales",
    "last_week_sales",
    "Last complete calendar week's (Monday through Sunday) order count and revenue, excluding cancelled orders.",
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_amount - discount), 0) AS revenue
     FROM orders
     WHERE created_at >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)
       AND created_at < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
       AND status != 'cancelled'`
  ),

  single(
    "count_todays_customers",
    "todays_customers",
    "Count of distinct customers who placed a non-cancelled order today.",
    `SELECT COUNT(DISTINCT user_id) AS customers
     FROM orders
     WHERE DATE(created_at) = CURDATE()
       AND status != 'cancelled'`
  ),

  single(
    "count_total_customers",
    "total_customers",
    "Total number of registered customer accounts.",
    `SELECT COUNT(*) AS customers
     FROM users
     WHERE role = 'customer'`
  ),

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "list_top_retailers",
    intent: "top_retailers",
    description: "Top customers by total spend on non-cancelled orders.",
    run: async ({ db }) => ({
      data: await allRows(
        db,
        `SELECT u.name,
                COALESCE(SUM(o.total_amount - o.discount), 0) AS total
         FROM orders o
         JOIN users u ON u.id = o.user_id
         WHERE o.status != 'cancelled'
         GROUP BY o.user_id
         ORDER BY total DESC
         LIMIT 10`
      ),
    }),
  },
];