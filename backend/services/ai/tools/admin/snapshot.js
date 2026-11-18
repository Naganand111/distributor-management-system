/**
 * Admin tools: business snapshot, alerts and overview queries.
 *
 * SQL is transcribed verbatim from the previous executeQuery() switch so
 * narration and stored metadata keep the exact same shape and values.
 */

import { effectiveThresholdSql } from "../../../../utils/inventoryThreshold.js";
import { ADMIN_TOOL_DEFAULTS, allRows, firstRow } from "./helpers.js";

/**
 * Shared by `business_summary` and `business_alerts`. Previously one
 * constant, BUSINESS_SNAPSHOT_SQL, served both intents.
 */
const BUSINESS_SNAPSHOT_SQL = `SELECT
     (SELECT COUNT(*) FROM orders
       WHERE DATE(created_at) = CURDATE() AND status != 'cancelled') AS today_orders,
     (SELECT COALESCE(SUM(total_amount - discount), 0) FROM orders
       WHERE DATE(created_at) = CURDATE() AND status != 'cancelled') AS today_revenue,
     (SELECT COUNT(DISTINCT user_id) FROM orders
       WHERE DATE(created_at) = CURDATE() AND status != 'cancelled') AS today_customers,
     (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
     (SELECT COUNT(*) FROM orders
       WHERE payment_status IN ('pending', 'partially_paid', 'unpaid')
         AND status != 'cancelled') AS outstanding_orders,
     (SELECT COALESCE(SUM(total_amount - discount + gst - paid_amount), 0) FROM orders
       WHERE payment_status IN ('pending', 'partially_paid', 'unpaid')
         AND status != 'cancelled') AS outstanding,
     (SELECT COUNT(*) FROM products
       WHERE stock <= ${effectiveThresholdSql()} AND status = 'active' AND is_deleted = 0) AS low_stock,
     (SELECT COUNT(*) FROM products
       WHERE stock <= ${effectiveThresholdSql()} AND is_deleted = 0) AS reorder_items,
     (SELECT COUNT(*) FROM products
       WHERE expiry_date IS NOT NULL AND expiry_date <= CURDATE()) AS expired_products,
     (SELECT COUNT(*) FROM damaged_inventory
       WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS damaged_recent`;

const single = (name, intent, description, sql) => ({
  ...ADMIN_TOOL_DEFAULTS,
  name,
  intent,
  description,
  run: async ({ db }) => ({ data: await firstRow(db, sql) }),
});

export const adminSnapshotTools = [
  single(
    "get_business_summary",
    "business_summary",
    "Today's orders, revenue and customers plus pending, outstanding, low-stock, reorder, expired and damaged counts.",
    BUSINESS_SNAPSHOT_SQL
  ),

  single(
    "get_business_alerts",
    "business_alerts",
    "Operational attention counts: today's trading, pending orders, outstanding payments, low stock, reorder items and damaged inventory.",
    BUSINESS_SNAPSHOT_SQL
  ),

  single(
    "get_inventory_health",
    "inventory_health",
    "Inventory health: active product count, low stock, reorder items, expired products, recent damage, priced products and cost/retail inventory value.",
    `SELECT
           (SELECT COUNT(*) FROM products
             WHERE status = 'active' AND is_deleted = 0) AS total_products,
           (SELECT COUNT(*) FROM products
             WHERE stock <= ${effectiveThresholdSql()} AND status = 'active' AND is_deleted = 0) AS low_stock,
           (SELECT COUNT(*) FROM products
             WHERE stock <= ${effectiveThresholdSql()} AND is_deleted = 0) AS reorder_items,
           (SELECT COUNT(*) FROM products
             WHERE expiry_date IS NOT NULL AND expiry_date <= CURDATE() AND is_deleted = 0) AS expired_products,
           (SELECT COUNT(*) FROM damaged_inventory
             WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS damaged_recent,
           (SELECT COUNT(*) FROM products
             WHERE is_deleted = 0 AND purchase_price IS NOT NULL AND purchase_price > 0) AS priced_products,
           (SELECT COALESCE(SUM(stock * purchase_price), 0) FROM products
             WHERE is_deleted = 0 AND purchase_price IS NOT NULL AND purchase_price > 0) AS inventory_cost_value,
           (SELECT COALESCE(SUM(stock * price), 0) FROM products
             WHERE is_deleted = 0 AND price IS NOT NULL AND price > 0) AS inventory_retail_value`
  ),

  single(
    "get_daily_performance",
    "daily_performance",
    "Today's and yesterday's order counts, revenue and distinct customer counts, side by side.",
    `SELECT
           (SELECT COUNT(*) FROM orders
             WHERE DATE(created_at) = CURDATE() AND status != 'cancelled') AS today_orders,
           (SELECT COALESCE(SUM(total_amount - discount), 0) FROM orders
             WHERE DATE(created_at) = CURDATE() AND status != 'cancelled') AS today_revenue,
           (SELECT COUNT(DISTINCT user_id) FROM orders
             WHERE DATE(created_at) = CURDATE() AND status != 'cancelled') AS today_customers,
           (SELECT COUNT(*) FROM orders
             WHERE DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND status != 'cancelled') AS yesterday_orders,
           (SELECT COALESCE(SUM(total_amount - discount), 0) FROM orders
             WHERE DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND status != 'cancelled') AS yesterday_revenue,
           (SELECT COUNT(DISTINCT user_id) FROM orders
             WHERE DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND status != 'cancelled') AS yesterday_customers`
  ),

  single(
    "get_monthly_performance",
    "monthly_performance",
    "This month's and last month's order counts, revenue and customer counts, side by side.",
    `SELECT
           (SELECT COUNT(*) FROM orders
             WHERE status != 'cancelled'
               AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS this_month_orders,
           (SELECT COALESCE(SUM(total_amount - discount), 0) FROM orders
             WHERE status != 'cancelled'
               AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS this_month_revenue,
           (SELECT COUNT(DISTINCT user_id) FROM orders
             WHERE status != 'cancelled'
               AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS this_month_customers,
           (SELECT COUNT(*) FROM orders
             WHERE status != 'cancelled'
               AND created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
               AND created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS last_month_orders,
           (SELECT COALESCE(SUM(total_amount - discount), 0) FROM orders
             WHERE status != 'cancelled'
               AND created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
               AND created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS last_month_revenue`
  ),

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "get_customer_overview",
    intent: "customer_overview",
    description:
      "Customer totals, new customers this month, customers with orders, this month's active customers, lifetime revenue and the top customer.",
    run: async ({ db }) => {
      const row = await firstRow(
        db,
        `SELECT
           (SELECT COUNT(*) FROM users WHERE role = 'customer') AS total_customers,
           (SELECT COUNT(*) FROM users
             WHERE role = 'customer'
               AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS new_customers_this_month,
           (SELECT COUNT(DISTINCT o.user_id) FROM orders o
             WHERE o.user_id IS NOT NULL AND o.status != 'cancelled') AS customers_with_orders,
           (SELECT COUNT(DISTINCT o.user_id) FROM orders o
             WHERE o.user_id IS NOT NULL AND o.status != 'cancelled'
               AND o.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS this_month_customers,
           (SELECT COALESCE(SUM(o.total_amount - o.discount), 0) FROM orders o
             WHERE o.status != 'cancelled') AS lifetime_revenue`
      );

      const top = await allRows(
        db,
        `SELECT COALESCE(NULLIF(o.customer_name, ''), NULLIF(u.name, ''), CONCAT('Customer #', o.user_id)) AS name,
                COUNT(*) AS orders,
                COALESCE(SUM(o.total_amount - o.discount), 0) AS spend
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         WHERE o.user_id IS NOT NULL AND o.status != 'cancelled'
         GROUP BY o.user_id, o.customer_name, u.name
         ORDER BY spend DESC
         LIMIT 1`
      );

      if (top && top[0]) {
        row.top_customer_name = top[0].name;
        row.top_customer_orders = Number(top[0].orders);
        row.top_customer_spend = Number(top[0].spend);
      }

      return { data: row };
    },
  },

  single(
    "get_business_recommendations",
    "business_recommendations",
    "Recommendation inputs: pending and in-progress orders, unpaid orders and amount, low stock, reorder items, expired products and recent damage.",
    `SELECT
           (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
           (SELECT COUNT(*) FROM orders
             WHERE status IN ('processing', 'confirmed', 'shipped')) AS in_progress_orders,
           (SELECT COUNT(*) FROM orders
             WHERE payment_status IN ('pending', 'partially_paid', 'unpaid')
               AND status != 'cancelled') AS outstanding_orders,
           (SELECT COALESCE(SUM(total_amount - discount + gst - paid_amount), 0) FROM orders
             WHERE payment_status IN ('pending', 'partially_paid', 'unpaid')
               AND status != 'cancelled') AS outstanding,
           (SELECT COUNT(*) FROM products
             WHERE stock <= ${effectiveThresholdSql()} AND status = 'active' AND is_deleted = 0) AS low_stock,
           (SELECT COUNT(*) FROM products
             WHERE stock <= ${effectiveThresholdSql()} AND is_deleted = 0) AS reorder_items,
           (SELECT COUNT(*) FROM products
             WHERE expiry_date IS NOT NULL AND expiry_date <= CURDATE() AND is_deleted = 0) AS expired_products,
           (SELECT COUNT(*) FROM damaged_inventory
             WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS damaged_recent`
  ),

  single(
    "get_product_overview",
    "product_overview",
    "Product overview: best and slowest selling product names, low stock, reorder items, expired products and recent damage.",
    `SELECT
           (SELECT p.name
              FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              JOIN orders o ON o.id = oi.order_id
             WHERE o.status != 'cancelled'
             GROUP BY oi.product_id
             ORDER BY SUM(oi.quantity) DESC
             LIMIT 1) AS top_product,
           (SELECT p.name
              FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              JOIN orders o ON o.id = oi.order_id
             WHERE o.status != 'cancelled'
             GROUP BY oi.product_id
             ORDER BY SUM(oi.quantity) ASC
             LIMIT 1) AS slow_product,
           (SELECT COUNT(*) FROM products
             WHERE stock <= ${effectiveThresholdSql()} AND status = 'active' AND is_deleted = 0) AS low_stock,
           (SELECT COUNT(*) FROM products
             WHERE stock <= ${effectiveThresholdSql()} AND is_deleted = 0) AS reorder_items,
           (SELECT COUNT(*) FROM products
             WHERE expiry_date IS NOT NULL AND expiry_date <= CURDATE()) AS expired_products,
           (SELECT COUNT(*) FROM damaged_inventory
             WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS damaged_recent`
  ),

  single(
    "get_order_overview",
    "order_overview",
    "Order counts: total orders, orders today, pending, cancelled and unpaid orders.",
    `SELECT
           (SELECT COUNT(*) FROM orders) AS total_orders,
           (SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURDATE()) AS today_orders,
           (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
           (SELECT COUNT(*) FROM orders WHERE status = 'cancelled') AS cancelled_orders,
           (SELECT COUNT(*) FROM orders
             WHERE payment_status IN ('pending', 'partially_paid', 'unpaid')
               AND status != 'cancelled') AS outstanding_orders`
  ),

  single(
    "get_payment_overview",
    "payment_overview",
    "Payment exposure: count of unpaid orders and total outstanding amount.",
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(total_amount - discount + gst - paid_amount), 0) AS outstanding
     FROM orders
     WHERE payment_status IN ('pending', 'partially_paid', 'unpaid')
       AND status != 'cancelled'`
  ),
];