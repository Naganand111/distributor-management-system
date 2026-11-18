/* =====================================================
   PHASE 8 - SMART INVENTORY & REORDER
   Admin only. Reorder levels/quantities, recommendations,
   fast/slow movers, health, and one-click PO creation
   (mirrors existing purchase-order insert; stock is only
   adjusted on receive, so negative stock is prevented).
===================================================== */


import { effectiveThresholdSql, isLowStockSql } from "../utils/inventoryThreshold.js";
export default function registerReorderRoutes(app, pool, authRequired, adminOnly) {
  const guard = [authRequired, adminOnly];

  /* ---- Product reorder settings ---- */
  app.put("/api/reorder/products/:id/settings", ...guard, async (req, res) => {
    try {
      const productId = Number(req.params.id);

      if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: "Invalid product id" });
      }

      const rawLevel = req.body.reorder_level;
      const rawQty = req.body.reorder_quantity;

      // Thresholds must be whole, non-negative numbers; 0 means "no reorder
      // policy configured", which is different from "always reorder".
      if (rawLevel != null && !Number.isInteger(Number(rawLevel))) {
        return res
          .status(400)
          .json({ error: "reorder_level must be a whole number" });
      }
      if (rawQty != null && !Number.isInteger(Number(rawQty))) {
        return res
          .status(400)
          .json({ error: "reorder_quantity must be a whole number" });
      }

      const reorderLevel = Math.max(Number(rawLevel) || 0, 0);
      const reorderQuantity = Math.max(Number(rawQty) || 0, 0);

      const [result] = await pool.query(
        "UPDATE products SET reorder_level=?, reorder_quantity=? WHERE id=? AND is_deleted=0",
        [reorderLevel, reorderQuantity, productId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      const [rows] = await pool.query(
        "SELECT id, name, sku, stock, reorder_level, reorder_quantity, min_stock_level, is_deleted FROM products WHERE id=?",
        [productId]
      );

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("SET REORDER SETTINGS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* ---- Reorder recommendations (stock <= effective threshold) ---- */
  app.get("/api/reorder/recommendations", ...guard, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT p.id, p.name, p.sku, p.stock, p.min_stock_level,
                p.reorder_level, p.reorder_quantity,
                ${effectiveThresholdSql("p")} AS effective_reorder_level,
                COALESCE(p.distributor_price, p.purchase_price, 0) AS cost_price
         FROM products p
         WHERE p.is_deleted = 0
           AND p.stock <= ${effectiveThresholdSql("p")}
         ORDER BY (p.stock - ${effectiveThresholdSql("p")}) ASC`
      );
      res.json(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error("REORDER RECOMMENDATIONS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* ---- Fast / slow movers ---- */
  app.get("/api/reorder/movers", ...guard, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT oi.product_id, p.name AS product_name, p.sku, p.stock,
                p.reorder_level, p.reorder_quantity,
                ${effectiveThresholdSql("p")} AS effective_reorder_level,
                SUM(oi.quantity) AS units_sold,
                AVG(oi.quantity) AS avg_per_order,
                COALESCE(p.stock / NULLIF(SUM(oi.quantity),0), 999) AS months_of_cover
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE p.is_deleted = 0
         GROUP BY oi.product_id, p.name, p.sku, p.stock, p.reorder_level, p.reorder_quantity
         ORDER BY units_sold DESC`
      );
      const list = Array.isArray(rows) ? rows : [];
      res.json({
        fastMovers: list.slice(0, 10),
        slowMovers: list.slice(-10).reverse(),
        all: list,
      });
    } catch (err) {
      console.error("REORDER MOVERS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* ---- Inventory health ---- */
  app.get("/api/reorder/health", ...guard, async (req, res) => {
    try {
      const [[stats]] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(${isLowStockSql()}) AS low,
                SUM(CASE WHEN ${isLowStockSql()} = 0 THEN 1 ELSE 0 END) AS healthy,
                SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) AS out_of_stock
         FROM products WHERE is_deleted = 0`
      );
      res.json({
        total: Number(stats?.total || 0),
        low: Number(stats?.low || 0),
        healthy: Number(stats?.healthy || 0),
        outOfStock: Number(stats?.out_of_stock || 0),
      });
    } catch (err) {
      console.error("REORDER HEALTH ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* ---- Create purchase order from recommendations ----
     Mirrors existing PO insert. No stock change here. */
  app.post("/api/reorder/purchase-order", ...guard, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { supplier_id, items = [], notes } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Add at least one product" });
      }
      for (const it of items) {
        if (Number(it.quantity) <= 0) {
          return res.status(400).json({ error: "Quantity must be positive" });
        }
      }
      await connection.beginTransaction();
      const poNumber = `PO-${Date.now().toString().slice(-6)}`;
      let total = 0;
      for (const it of items) {
        total += Number(it.quantity || 0) * Number(it.purchase_price || 0);
      }
      const [r] = await connection.query(
        `INSERT INTO purchase_orders
         (po_number, supplier_id, order_date, expected_delivery, total_amount, status, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        [poNumber, supplier_id || null, new Date(), null, total, "draft", notes || "Generated from reorder recommendations", req.user.id]
      );
      const poId = r.insertId;
      for (const it of items) {
        const qty = Number(it.quantity);
        const price = Number(it.purchase_price || 0);
        await connection.query(
          `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, purchase_price, total)
           VALUES (?,?,?,?,?)`,
          [poId, it.product_id, qty, price, qty * price]
        );
      }
      await connection.commit();
      res.status(201).json({ success: true, id: poId, po_number: poNumber });
    } catch (err) {
      await connection.rollback();
      console.error("REORDER PO CREATE ERROR:", err);
      res.status(500).json({ error: "Failed to create purchase order" });
    } finally {
      connection.release();
    }
  });
}
