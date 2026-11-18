import express from "express";

export default function registerPromotionsRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();
  const admin = [adminOnly];

  /* =====================================================
     GET /active — public: list active promotions valid now
     (authRequired only — reachable by non-admin users)
  ===================================================== */

  router.get("/active", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM promotions
         WHERE status = 'active'
           AND (start_date IS NULL OR start_date <= CURDATE())
           AND (end_date IS NULL OR end_date >= CURDATE())
           AND (usage_limit IS NULL OR used_count < usage_limit)
         ORDER BY priority DESC, name ASC`
      );

      res.json(rows);
    } catch (err) {
      console.error("GET ACTIVE PROMOTIONS ERROR:", err);
      res.status(500).json({ error: "Failed to fetch active promotions" });
    }
  });

  /* =====================================================
     GET / — list all promotions
  ===================================================== */

  router.get("/", ...admin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT p.*,
                (SELECT COUNT(*) FROM promotion_usage pu WHERE pu.promotion_id = p.id) AS used_count
         FROM promotions p
         ORDER BY FIELD(p.status, 'active', 'inactive') ASC, p.priority DESC, p.name ASC`
      );

      res.json(rows);
    } catch (err) {
      console.error("GET PROMOTIONS ERROR:", err);
      res.status(500).json({ error: "Failed to fetch promotions" });
    }
  });

  /* =====================================================
     GET /:id — single promotion detail
  ===================================================== */

  router.get("/:id", ...admin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM promotions WHERE id=?",
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      res.json(rows[0]);
    } catch (err) {
      console.error("GET PROMOTION ERROR:", err);
      res.status(500).json({ error: "Failed to fetch promotion" });
    }
  });

  /* =====================================================
     POST / — create promotion
  ===================================================== */

  router.post("/", ...admin, async (req, res) => {
    try {
      const {
        code, name, description, type, value,
        min_order_value, buy_qty, get_qty,
        product_id, category_id, customer_id,
        start_date, end_date, usage_limit, priority, status,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Promotion name is required" });
      }

      if (!type) {
        return res.status(400).json({ error: "Promotion type is required" });
      }

      const validTypes = ["percentage", "fixed", "buy_x_get_y", "min_order", "product", "category", "customer", "quantity"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }

      if (code) {
        const [[existing]] = await pool.query(
          "SELECT id FROM promotions WHERE code=?",
          [code.trim()]
        );
        if (existing) {
          return res.status(400).json({ error: "Promotion code already exists" });
        }
      }

      if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({ error: "Start date must be before end date" });
      }

      if (type === "buy_x_get_y" && (!buy_qty || !get_qty)) {
        return res.status(400).json({ error: "buy_qty and get_qty are required for buy_x_get_y type" });
      }

      const [result] = await pool.query(
        `INSERT INTO promotions
         (code, name, description, type, value, min_order_value, buy_qty, get_qty,
          product_id, category_id, customer_id, start_date, end_date, usage_limit,
          priority, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          code || null,
          name.trim(),
          description || null,
          type,
          value || 0,
          min_order_value || 0,
          buy_qty || null,
          get_qty || null,
          product_id || null,
          category_id || null,
          customer_id || null,
          start_date || null,
          end_date || null,
          usage_limit || null,
          priority || 0,
          status || "active",
          req.user.id,
        ]
      );

      res.status(201).json({ success: true, id: result.insertId });
    } catch (err) {
      console.error("CREATE PROMOTION ERROR:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ error: "Promotion code already exists" });
      }

      res.status(500).json({ error: "Failed to create promotion" });
    }
  });

  /* =====================================================
     PUT /:id — update promotion
  ===================================================== */

  router.put("/:id", ...admin, async (req, res) => {
    try {
      const {
        code, name, description, type, value,
        min_order_value, buy_qty, get_qty,
        product_id, category_id, customer_id,
        start_date, end_date, usage_limit, priority, status,
      } = req.body;

      const [existingRows] = await pool.query(
        "SELECT id FROM promotions WHERE id=?",
        [req.params.id]
      );

      if (!existingRows.length) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      if (code) {
        const [[dup]] = await pool.query(
          "SELECT id FROM promotions WHERE code=? AND id != ?",
          [code.trim(), req.params.id]
        );
        if (dup) {
          return res.status(400).json({ error: "Promotion code already exists" });
        }
      }

      if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({ error: "Start date must be before end date" });
      }

      await pool.query(
        `UPDATE promotions SET
           code=?, name=?, description=?, type=?, value=?,
           min_order_value=?, buy_qty=?, get_qty=?,
           product_id=?, category_id=?, customer_id=?,
           start_date=?, end_date=?, usage_limit=?,
           priority=?, status=?
         WHERE id=?`,
        [
          code || null,
          name ? name.trim() : null,
          description !== undefined ? description : null,
          type || null,
          value !== undefined ? value : null,
          min_order_value !== undefined ? min_order_value : null,
          buy_qty !== undefined ? buy_qty : null,
          get_qty !== undefined ? get_qty : null,
          product_id !== undefined ? product_id : null,
          category_id !== undefined ? category_id : null,
          customer_id !== undefined ? customer_id : null,
          start_date !== undefined ? start_date : null,
          end_date !== undefined ? end_date : null,
          usage_limit !== undefined ? usage_limit : null,
          priority !== undefined ? priority : null,
          status || null,
          req.params.id,
        ]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("UPDATE PROMOTION ERROR:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ error: "Promotion code already exists" });
      }

      res.status(500).json({ error: "Failed to update promotion" });
    }
  });

  /* =====================================================
     DELETE /:id — soft delete (set inactive)
  ===================================================== */

  router.delete("/:id", ...admin, async (req, res) => {
    try {
      const [existingRows] = await pool.query(
        "SELECT id FROM promotions WHERE id=?",
        [req.params.id]
      );

      if (!existingRows.length) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      await pool.query(
        "UPDATE promotions SET status='inactive' WHERE id=?",
        [req.params.id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE PROMOTION ERROR:", err);
      res.status(500).json({ error: "Failed to delete promotion" });
    }
  });

  /* =====================================================
     POST /:id/toggle — toggle active/inactive
  ===================================================== */

  router.post("/:id/toggle", ...admin, async (req, res) => {
    try {
      const [existingRows] = await pool.query(
        "SELECT id, status FROM promotions WHERE id=?",
        [req.params.id]
      );

      if (!existingRows.length) {
        return res.status(404).json({ error: "Promotion not found" });
      }

      const newStatus = existingRows[0].status === "active" ? "inactive" : "active";

      await pool.query(
        "UPDATE promotions SET status=? WHERE id=?",
        [newStatus, req.params.id]
      );

      res.json({ success: true, status: newStatus });
    } catch (err) {
      console.error("TOGGLE PROMOTION ERROR:", err);
      res.status(500).json({ error: "Failed to toggle promotion" });
    }
  });

  /* =====================================================
     REGISTER ROUTER (authRequired at mount; adminOnly per-route
     so /active stays reachable by any authenticated user)
  ===================================================== */

  app.use("/api/promotions", authRequired, router);
}