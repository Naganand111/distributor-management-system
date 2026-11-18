import express from "express";

export default function registerBarcodeRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  // Public scan lookup
  app.get("/api/barcode/search", authRequired, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: "Search query required" });

      const like = `%${q}%`;
      const [products] = await pool.query(
        `SELECT p.id, p.name, p.barcode, p.sku, p.price, p.mrp, p.purchase_price,
                p.stock, p.expiry_date, c.name AS category, b.name AS brand
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.barcode LIKE ? OR p.sku LIKE ? OR p.name LIKE ?`,
        [like, like, like]
      );

      if (products.length === 0) return res.json([]);

      const ids = products.map((p) => p.id);
      const placeholders = ids.map(() => "?").join(",");
      const [warehouseRows] = await pool.query(
        `SELECT product_id, SUM(quantity) AS quantity, w.name AS warehouse
         FROM warehouse_inventory wi
         JOIN warehouses w ON w.id = wi.warehouse_id
         WHERE product_id IN (${placeholders})
         GROUP BY product_id, w.id, w.name`,
        ids
      );

      const warehouseMap = {};
      for (const row of warehouseRows) {
        if (!warehouseMap[row.product_id]) warehouseMap[row.product_id] = [];
        warehouseMap[row.product_id].push({ warehouse: row.warehouse, quantity: row.quantity });
      }

      const result = products.map((p) => ({
        ...p,
        warehouseStock: warehouseMap[p.id] || [],
      }));

      res.json(result);
    } catch (err) {
      console.error("Barcode search error:", err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.get("/api/barcode/product/:id", authRequired, async (req, res) => {
    try {
      const { id } = req.params;

      const [products] = await pool.query(
        `SELECT p.*, c.name AS category, b.name AS brand, s.company_name AS supplier
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.id = ?`,
        [id]
      );

      if (products.length === 0) return res.status(404).json({ error: "Product not found" });

      const product = products[0];

      const [warehouseRows] = await pool.query(
        `SELECT w.name AS warehouse, wi.quantity
         FROM warehouse_inventory wi
         JOIN warehouses w ON w.id = wi.warehouse_id
         WHERE wi.product_id = ?`,
        [id]
      );

      const [movements] = await pool.query(
        `SELECT * FROM inventory_movements WHERE product_id = ? ORDER BY created_at DESC LIMIT 5`,
        [id]
      );

      res.json({
        ...product,
        warehouseStock: warehouseRows,
        recentMovements: movements,
      });
    } catch (err) {
      console.error("Barcode product error:", err);
      res.status(500).json({ error: "Failed to get product" });
    }
  });

  // Admin-only: set barcode
  router.post("/set-barcode", async (req, res) => {
    try {
      const { productId, barcode } = req.body;
      if (!productId || !barcode) return res.status(400).json({ error: "productId and barcode required" });

      const [existing] = await pool.query("SELECT id FROM products WHERE barcode = ? AND id != ?", [barcode, productId]);
      if (existing.length > 0) return res.status(409).json({ error: "Barcode already assigned to another product" });

      await pool.query("UPDATE products SET barcode = ? WHERE id = ?", [barcode, productId]);
      res.json({ message: "Barcode updated successfully" });
    } catch (err) {
      console.error("Set barcode error:", err);
      res.status(500).json({ error: "Failed to set barcode" });
    }
  });

  app.use("/api/barcode", authRequired, adminOnly, router);
}
