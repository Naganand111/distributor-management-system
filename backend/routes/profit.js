import express from "express";

export default function registerProfitRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  /* =====================================================
     GET /summary — profit & margin overview + product breakdown
  ===================================================== */

  router.get("/summary", async (req, res) => {
    try {
      const [[revenueRow]] = await pool.query(
        `SELECT COALESCE(SUM(oi.price * oi.quantity), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'`
      );

      const [[costRow]] = await pool.query(
        `SELECT COALESCE(SUM(p.purchase_price * oi.quantity), 0) AS cost
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'`
      );

      const totalRevenue = Number(revenueRow.revenue);
      const totalCost = Number(costRow.cost);
      const grossProfit = totalRevenue - totalCost;
      const margin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(2) : 0;

      const [products] = await pool.query(
        `SELECT
           p.name AS product_name,
           p.purchase_price,
           ROUND(AVG(oi.price), 2) AS avg_selling_price,
           SUM(oi.quantity) AS qty_sold,
           ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
           ROUND(SUM(p.purchase_price * oi.quantity), 2) AS cost,
           ROUND(SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity), 2) AS profit,
           CASE
             WHEN SUM(oi.price * oi.quantity) > 0
               THEN ROUND(((SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity)) / SUM(oi.price * oi.quantity)) * 100, 2)
               ELSE 0
           END AS margin_pct
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'
         GROUP BY oi.product_id, p.name, p.purchase_price
         ORDER BY profit DESC`
      );

      const [topProfitable] = await pool.query(
        `SELECT
           p.name AS product_name,
           ROUND(SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity), 2) AS profit,
           ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
           CASE
             WHEN SUM(oi.price * oi.quantity) > 0
               THEN ROUND(((SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity)) / SUM(oi.price * oi.quantity)) * 100, 2)
               ELSE 0
           END AS margin_pct
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'
         GROUP BY oi.product_id, p.name
         ORDER BY profit DESC
         LIMIT 5`
      );

      const [lowMargin] = await pool.query(
        `SELECT
           p.name AS product_name,
           ROUND(SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity), 2) AS profit,
           ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
           CASE
             WHEN SUM(oi.price * oi.quantity) > 0
               THEN ROUND(((SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity)) / SUM(oi.price * oi.quantity)) * 100, 2)
               ELSE 0
           END AS margin_pct
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'
         GROUP BY oi.product_id, p.name
         HAVING COUNT(*) > 0
         ORDER BY margin_pct ASC
         LIMIT 5`
      );

      const [monthlyTrend] = await pool.query(
        `SELECT
           DATE_FORMAT(o.created_at, '%Y-%m') AS month,
           ROUND(SUM(oi.price * oi.quantity), 2) AS revenue,
           ROUND(SUM(p.purchase_price * oi.quantity), 2) AS cost,
           ROUND(SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity), 2) AS profit,
           CASE
             WHEN SUM(oi.price * oi.quantity) > 0
               THEN ROUND(((SUM(oi.price * oi.quantity) - SUM(p.purchase_price * oi.quantity)) / SUM(oi.price * oi.quantity)) * 100, 2)
               ELSE 0
           END AS margin_pct
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'delivered'
           AND o.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
         GROUP BY DATE_FORMAT(o.created_at, '%Y-%m')
         ORDER BY month ASC`
      );

      res.json({
        summary: {
          revenue: totalRevenue,
          cost: totalCost,
          profit: grossProfit,
          margin: Number(margin),
        },
        products,
        topProfitable,
        lowMargin,
        monthlyTrend,
      });
    } catch (err) {
      console.error("PROFIT SUMMARY ERROR:", err);
      res.status(500).json({ error: "Failed to fetch profit summary" });
    }
  });

  /* =====================================================
     REGISTER ROUTER
  ===================================================== */

  app.use("/api/profit", authRequired, adminOnly, router);
}
