/**
 * Admin tools: stock, reorder, expiry and damage queries.
 */

import { effectiveThresholdSql } from "../../../../utils/inventoryThreshold.js";
import { ADMIN_TOOL_DEFAULTS, allRows, firstRow } from "./helpers.js";

const single = (name, intent, description, sql) => ({
  ...ADMIN_TOOL_DEFAULTS,
  name,
  intent,
  description,
  run: async ({ db }) => ({ data: await firstRow(db, sql) }),
});

export const adminInventoryTools = [
  single(
    "count_low_stock",
    "low_stock",
    "Count of active products that have reached their effective low-stock threshold.",
    `SELECT COUNT(*) AS count
     FROM products
     WHERE stock <= ${effectiveThresholdSql()}
       AND status = 'active'
       AND is_deleted = 0`
  ),

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "list_top_products",
    intent: "top_products",
    description: "Best selling products by quantity, with quantity and revenue.",
    run: async ({ db }) => ({
      data: await allRows(
        db,
        `SELECT p.name,
                SUM(oi.quantity) AS qty,
                SUM(oi.price * oi.quantity) AS revenue
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status != 'cancelled'
         GROUP BY oi.product_id
         ORDER BY qty DESC
         LIMIT 10`
      ),
    }),
  },

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "list_slow_products",
    intent: "slow_products",
    description: "Slowest moving products by quantity sold, with quantity and revenue.",
    run: async ({ db }) => ({
      data: await allRows(
        db,
        `SELECT p.name,
                SUM(oi.quantity) AS qty,
                SUM(oi.price * oi.quantity) AS revenue
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status != 'cancelled'
         GROUP BY oi.product_id
         ORDER BY qty ASC
         LIMIT 10`
      ),
    }),
  },

  single(
    "get_inventory_value",
    "inventory_value",
    "Total active inventory value at purchase price.",
    `SELECT COALESCE(SUM(stock * purchase_price), 0) AS value
     FROM products
     WHERE status = 'active'
       AND is_deleted = 0`
  ),

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "list_reorder_items",
    intent: "reorder",
    description:
      "Products at or below their effective reorder threshold, with the computed effective level, ordered by urgency.",
    maxRows: 50,
    run: async ({ db }) => ({
      data: await allRows(
        db,
        `SELECT p.name,
                p.sku,
                p.stock,
                p.reorder_level,
                p.min_stock_level,
                ${effectiveThresholdSql("p")} AS effective_reorder_level
         FROM products p
WHERE p.is_deleted = 0
          AND p.stock <= ${effectiveThresholdSql("p")}
         ORDER BY (p.stock - ${effectiveThresholdSql("p")}), p.name
         LIMIT 50`
      ),
    }),
  },

  {
    ...ADMIN_TOOL_DEFAULTS,
    name: "get_expiry_summary",
    intent: "expired",
    description: "Expired products currently on the catalogue plus expiry records logged in the last 30 days.",
    run: async ({ db }) => {
      const recent = await firstRow(
        db,
        `SELECT COUNT(*) AS count
         FROM expired_inventory
         WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
      );

      const onProducts = await firstRow(
        db,
        `SELECT COUNT(*) AS count
         FROM products
         WHERE expiry_date IS NOT NULL
           AND expiry_date <= CURDATE()`
      );

      return {
        data: {
          expired_products: onProducts.count,
          recent_expiry_records: recent.count,
        },
      };
    },
  },

  single(
    "count_damaged_inventory",
    "damaged",
    "Count of damaged inventory records logged in the last 30 days.",
    `SELECT COUNT(*) AS count
     FROM damaged_inventory
     WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  ),
];