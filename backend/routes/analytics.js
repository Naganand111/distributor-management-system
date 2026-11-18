/* =====================================================
   PHASE 7 - ADVANCED ANALYTICS / BI
   Admin only. Aggregates from existing tables with an
   optional from/to date range (default: last 30 days).
===================================================== */


import { effectiveThresholdSql, isLowStockSql } from "../utils/inventoryThreshold.js";
export default function registerAnalyticsRoutes(app, pool, authRequired, adminOnly) {
  const guard = [authRequired, adminOnly];

  function dateBounds(query) {
    const to = query.to || null;
    const from = query.from || null;
    return { to, from };
  }

  function clamp(n) {
    return Number.isFinite(Number(n)) ? Number(n) : 0;
  }

  app.get("/api/analytics/overview", ...guard, async (req, res) => {
    try {
      const { from, to } = dateBounds(req.query);
      const where = [];
      const params = [];
      if (from) { where.push("o.created_at >= ?"); params.push(`${from} 00:00:00`); }
      if (to) { where.push("o.created_at <= ?"); params.push(`${to} 23:59:59`); }
      const wq = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // A cancelled order is not revenue: its stock is restored and nothing is
      // owed, so every money aggregate below excludes it - the same rule
      // /api/analytics/trend and /api/analytics/performance already apply.
      // Operational counts stay unfiltered so cancelled orders stay visible.
      const moneyWq = `WHERE o.status <> 'cancelled'${
        where.length ? ` AND ${where.join(" AND ")}` : ""
      }`;

      const [[orderCounts]] = await pool.query(
        `SELECT COUNT(*) AS total_orders FROM orders o ${wq}`
      , params);

      const [[sales]] = await pool.query(
        `SELECT COUNT(*) AS total_orders,
                COALESCE(SUM(o.total_amount),0) AS total_sales,
                COALESCE(SUM(o.discount),0) AS total_discount,
                COALESCE(SUM(o.gst),0) AS total_gst,
                COALESCE(SUM(o.total_amount - IFNULL(o.discount,0) + IFNULL(o.gst,0)),0) AS gross_revenue
         FROM orders o ${moneyWq}`
      , params);

      const [[collections]] = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total_received,
                COUNT(*) AS total_payments
         FROM payments p
         INNER JOIN orders o ON o.id = p.order_id
         ${moneyWq}`
      , params);

      const [[newCustomers]] = await pool.query(
        `SELECT COUNT(*) AS new_retailers FROM retailers
         ${wq.replace(/o\./g, "")}`
      , params);

      const [orderStatus] = await pool.query(
        `SELECT o.status, COUNT(*) AS cnt FROM orders o ${wq} GROUP BY o.status`
      , params);

      const [topProducts] = await pool.query(
        `SELECT oi.product_id, p.name AS product_name, p.sku,
                SUM(oi.quantity) AS units_sold,
                SUM(oi.quantity * oi.price) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         ${moneyWq}
         GROUP BY oi.product_id, p.name, p.sku
         ORDER BY revenue DESC
         LIMIT 10`
      , params);

      const [topRetailers] = await pool.query(
        `SELECT o.retailer_id, r.name AS retailer_name,
                COUNT(o.id) AS orders,
                COALESCE(SUM(o.total_amount),0) AS revenue
         FROM orders o
         LEFT JOIN retailers r ON r.id = o.retailer_id
         ${moneyWq}
         GROUP BY o.retailer_id, r.name
         ORDER BY revenue DESC
         LIMIT 10`
      , params);

      res.json({
        summary: {
          totalOrders: Number(orderCounts?.total_orders || 0),
          totalSales: clamp(sales?.total_sales),
          totalDiscount: clamp(sales?.total_discount),
          totalGst: clamp(sales?.total_gst),
          grossRevenue: clamp(sales?.gross_revenue),
          totalReceived: clamp(collections?.total_received),
          totalPayments: Number(collections?.total_payments || 0),
          newRetailers: Number(newCustomers?.new_retailers || 0),
        },
        orderStatus: Array.isArray(orderStatus) ? orderStatus : [],
        topProducts: Array.isArray(topProducts) ? topProducts : [],
        topRetailers: Array.isArray(topRetailers) ? topRetailers : [],
      });
    } catch (err) {
      console.error("ANALYTICS OVERVIEW ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* Daily sales trend for a date range */
  app.get("/api/analytics/trend", ...guard, async (req, res) => {
    try {
      const { from, to } = dateBounds(req.query);
      const where = ["o.status NOT IN ('cancelled')"];
      const params = [];
      if (from) { where.push("o.created_at >= ?"); params.push(`${from} 00:00:00`); }
      if (to) { where.push("o.created_at <= ?"); params.push(`${to} 23:59:59`); }
      const wq = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const [rows] = await pool.query(
        `SELECT DATE(o.created_at) AS day,
                COUNT(o.id) AS orders,
                COALESCE(SUM(o.total_amount),0) AS revenue
         FROM orders o
         ${wq}
         GROUP BY DATE(o.created_at)
         ORDER BY day`
      , params);

      res.json(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error("ANALYTICS TREND ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* Sales rep & territory performance */
  app.get("/api/analytics/performance", ...guard, async (req, res) => {
    try {
      const [reps] = await pool.query(
        `SELECT sr.id, sr.name,
                COUNT(DISTINCT sr2.retailer_id) AS retailers_assigned,
                COUNT(DISTINCT o.id) AS orders,
                COALESCE(SUM(o.total_amount),0) AS revenue
         FROM sales_representatives sr
         LEFT JOIN sales_rep_retailers sr2 ON sr2.sales_rep_id = sr.id
         LEFT JOIN retailers r ON r.id = sr2.retailer_id
         LEFT JOIN orders o ON o.retailer_id = r.id AND o.status NOT IN ('cancelled')
         GROUP BY sr.id, sr.name
         ORDER BY revenue DESC`
      );

      const [territories] = await pool.query(
        `SELECT t.id, t.name,
                COUNT(DISTINCT r.id) AS retailers,
                COUNT(DISTINCT o.id) AS orders,
                COALESCE(SUM(o.total_amount),0) AS revenue
         FROM territories t
         LEFT JOIN retailers r ON r.territory_id = t.id
         LEFT JOIN orders o ON o.retailer_id = r.id AND o.status NOT IN ('cancelled')
         GROUP BY t.id, t.name
         ORDER BY revenue DESC`
      );

      res.json({
        representatives: Array.isArray(reps) ? reps : [],
        territories: Array.isArray(territories) ? territories : [],
      });
    } catch (err) {
      console.error("ANALYTICS PERFORMANCE ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* Inventory value + stock movement breakdown */
  app.get("/api/analytics/inventory", ...guard, async (req, res) => {
    try {
      const [[value]] = await pool.query(
        `SELECT COUNT(*) AS total_products,
                COALESCE(SUM(stock),0) AS total_units,
                COALESCE(SUM(CASE WHEN distributor_price IS NOT NULL THEN stock * distributor_price ELSE 0 END),0) AS stock_value
         FROM products WHERE is_deleted = 0`
      );

      const [movementSummary] = await pool.query(
        `SELECT movement_type, COUNT(*) AS count, COALESCE(SUM(quantity),0) AS qty
         FROM inventory_movements
         GROUP BY movement_type`
      );

const [[lowStock]] = await pool.query(
      `SELECT COUNT(*) AS low_stock FROM products
WHERE is_deleted = 0 AND stock <= ${effectiveThresholdSql()}`
    );

      const [[expiringSoon]] = await pool.query(
        `SELECT COUNT(*) AS expiring_soon FROM products
         WHERE is_deleted = 0 AND expiry_date IS NOT NULL
           AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`
      );

      res.json({
        inventory: {
          totalProducts: Number(value?.total_products || 0),
          totalUnits: Number(value?.total_units || 0),
          stockValue: clamp(value?.stock_value),
          lowStock: Number(lowStock?.low_stock || 0),
          expiringSoon: Number(expiringSoon?.expiring_soon || 0),
        },
        movementSummary: Array.isArray(movementSummary) ? movementSummary : [],
      });
    } catch (err) {
      console.error("ANALYTICS INVENTORY ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* Returns / damage / expiry summary */
  app.get("/api/analytics/quality", ...guard, async (req, res) => {
    try {
      const [returns] = await pool.query(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount
         FROM returns GROUP BY status`
      );
      const [damaged] = await pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(quantity),0) AS qty FROM damaged_inventory`
      );
      const [expired] = await pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(quantity),0) AS qty FROM expired_inventory`
      );
      res.json({
        returns: Array.isArray(returns) ? returns : [],
        damaged: Number(damaged?.[0]?.count || 0),
        damagedUnits: Number(damaged?.[0]?.qty || 0),
        expired: Number(expired?.[0]?.count || 0),
        expiredUnits: Number(expired?.[0]?.qty || 0),
      });
    } catch (err) {
      console.error("ANALYTICS QUALITY ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
}
