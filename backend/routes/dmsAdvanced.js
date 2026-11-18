import express from "express";
import { logActivity } from "../utils/activityLogger.js";
import { createNotification } from "../utils/notificationService.js";

/* =====================================================
   DMS ADVANCED - Phases 1-5
   Sales, Territories, Purchases, Returns, Damaged/Expiry
   ===================================================== */

export default function registerDmsAdvancedRoutes(
  app,
  pool,
  authRequired,
  adminOnly
) {
  /* =====================================================
     PHASE 1 - SALES REPRESENTATIVES
  ===================================================== */

  app.get("/api/sales-representatives", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT sr.*,
                t.name AS territory_name,
                (SELECT COUNT(*) FROM sales_rep_retailers r WHERE r.sales_rep_id = sr.id) AS retailer_count
         FROM sales_representatives sr
         LEFT JOIN territories t ON t.id = sr.territory_id
         WHERE sr.status = 'active'
         ORDER BY sr.name ASC`
      );
      for (const row of rows) {
        const [assigned] = await pool.query(
          "SELECT retailer_id FROM sales_rep_retailers WHERE sales_rep_id=?",
          [row.id]
        );
        row.retailer_ids = assigned.map((a) => a.retailer_id);
      }
      res.json(rows);
    } catch (err) {
      console.error("GET SALES REPS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/sales-representatives", authRequired, adminOnly, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const {
        user_id, employee_code, name, email, phone, territory,
        territory_id, joining_date, target_amount, commission_percentage,
        status = "active", retailer_ids = [],
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name is required" });
      }

      await connection.beginTransaction();

      const [r] = await connection.query(
        `INSERT INTO sales_representatives
         (user_id, employee_code, name, email, phone, territory, territory_id,
          joining_date, target_amount, commission_percentage, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          user_id || null, employee_code || null, name.trim(), email || null,
          phone || null, territory || null, territory_id || null,
          joining_date || null, target_amount || 0, commission_percentage || 0, status,
        ]
      );

      const repId = r.insertId;

      for (const rid of Array.isArray(retailer_ids) ? retailer_ids : []) {
        if (!rid) continue;
        await connection.query(
          "INSERT IGNORE INTO sales_rep_retailers (sales_rep_id, retailer_id) VALUES (?,?)",
          [repId, rid]
        );
      }

      await connection.commit();
      res.status(201).json({ success: true, id: repId });
    } catch (err) {
      await connection.rollback();
      console.error("CREATE SALES REP ERROR:", err);
      res.status(500).json({ error: "Failed to create sales representative" });
    } finally {
      connection.release();
    }
  });

  app.put("/api/sales-representatives/:id", authRequired, adminOnly, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const id = req.params.id;
      const {
        user_id, employee_code, name, email, phone, territory,
        territory_id, joining_date, target_amount, commission_percentage,
        status, retailer_ids,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name is required" });
      }

      await connection.beginTransaction();

      await connection.query(
        `UPDATE sales_representatives SET
           user_id=?, employee_code=?, name=?, email=?, phone=?, territory=?,
           territory_id=?, joining_date=?, target_amount=?, commission_percentage=?, status=?
         WHERE id=?`,
        [
          user_id || null, employee_code || null, name.trim(), email || null,
          phone || null, territory || null, territory_id || null,
          joining_date || null, target_amount || 0, commission_percentage || 0,
          status || "active", id,
        ]
      );

      if (Array.isArray(retailer_ids)) {
        await connection.query("DELETE FROM sales_rep_retailers WHERE sales_rep_id=?", [id]);
        for (const rid of retailer_ids) {
          if (!rid) continue;
          await connection.query(
            "INSERT IGNORE INTO sales_rep_retailers (sales_rep_id, retailer_id) VALUES (?,?)",
            [id, rid]
          );
        }
      }

      await connection.commit();
      res.json({ success: true });
    } catch (err) {
      await connection.rollback();
      console.error("UPDATE SALES REP ERROR:", err);
      res.status(500).json({ error: "Failed to update sales representative" });
    } finally {
      connection.release();
    }
  });

  app.delete("/api/sales-representatives/:id", authRequired, adminOnly, async (req, res) => {
    try {
      await pool.query(
        "UPDATE retailers SET sales_rep_id=NULL WHERE sales_rep_id=?",
        [req.params.id]
      );
      await pool.query(
        "UPDATE territories SET manager_id=NULL WHERE manager_id=?",
        [req.params.id]
      );
      const [rep] = await pool.query(
        "UPDATE sales_representatives SET status='inactive' WHERE id=? AND status='active'",
        [req.params.id]
      );
      res.json({ success: true, softDeleted: rep.affectedRows === 1 });
    } catch (err) {
      console.error("DELETE SALES REP ERROR:", err);
      res.status(500).json({ error: "Failed to delete sales representative" });
    }
  });

  /* =====================================================
     PHASE 1 - SALES TARGETS
  ===================================================== */

  app.get("/api/sales/targets", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT st.id, st.sales_rep_id, st.territory_id, st.period, st.target_amount,
                sr.name AS sales_rep_name, t.name AS territory_name,
                COALESCE(ms.monthly_sales,0) AS achieved_amount
         FROM sales_targets st
         JOIN sales_representatives sr ON sr.id = st.sales_rep_id
         LEFT JOIN territories t ON t.id = st.territory_id
         LEFT JOIN (
           SELECT
             r.sales_rep_id,
             DATE_FORMAT(o.created_at,'%Y-%m') AS ym,
             SUM(o.total_amount - o.discount) AS monthly_sales
           FROM orders o
           JOIN retailers r ON r.id = o.retailer_id
           WHERE r.sales_rep_id IS NOT NULL
           GROUP BY r.sales_rep_id, ym
         ) ms ON ms.sales_rep_id = st.sales_rep_id AND ms.ym = st.period
         ORDER BY st.period DESC`
      );

      const enriched = rows.map((r) => {
        const target = Number(r.target_amount || 0);
        const achieved = Number(r.achieved_amount || 0);
        return {
          ...r,
          achievement_pct: target > 0 ? Math.min(Math.round((achieved / target) * 100), 999) : 0,
        };
      });
      res.json(enriched);
    } catch (err) {
      console.error("GET SALES TARGETS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/sales/targets", authRequired, adminOnly, async (req, res) => {
    try {
      const { sales_rep_id, territory_id, period, target_amount } = req.body;
      if (!sales_rep_id || !period) {
        return res.status(400).json({ error: "Sales rep and period are required" });
      }
      await pool.query(
        `INSERT INTO sales_targets (sales_rep_id, territory_id, period, target_amount)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE target_amount=VALUES(target_amount), territory_id=VALUES(territory_id)`,
        [sales_rep_id, territory_id || null, period, target_amount || 0]
      );
      res.status(201).json({ success: true });
    } catch (err) {
      console.error("SET SALES TARGET ERROR:", err);
      res.status(500).json({ error: "Failed to set sales target" });
    }
  });

  app.put("/api/sales/targets/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const { target_amount, territory_id } = req.body;
      await pool.query(
        "UPDATE sales_targets SET target_amount=?, territory_id=? WHERE id=?",
        [target_amount || 0, territory_id || null, req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("UPDATE SALES TARGET ERROR:", err);
      res.status(500).json({ error: "Failed to update sales target" });
    }
  });

  /* =====================================================
     PHASE 1 - SALES PERFORMANCE / LEADERBOARD / COMMISSIONS
  ===================================================== */

  app.get("/api/sales/performance", authRequired, adminOnly, async (req, res) => {
    try {
      const { month } = req.query; // optional YYYY-MM
      const periodClause = month ? "AND DATE_FORMAT(o.created_at,'%Y-%m') = ?" : "";
      const params = [];
      if (month) params.push(month);

      const [rows] = await pool.query(
        `SELECT
           sr.id AS sales_rep_id,
           sr.name AS sales_rep_name,
           sr.commission_percentage,
           COALESCE(sr.target_amount,0) AS target_amount,
           COUNT(DISTINCT o.id) AS orders_count,
           COALESCE(SUM(o.total_amount - o.discount),0) AS total_sales,
           COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.total_amount - o.discount ELSE 0 END),0) AS collected,
           COALESCE(SUM(CASE WHEN o.payment_status<>'paid' THEN o.total_amount - o.discount ELSE 0 END),0) AS pending
         FROM sales_representatives sr
         LEFT JOIN retailers r ON r.sales_rep_id = sr.id
         LEFT JOIN orders o ON o.retailer_id = r.id ${periodClause}
         WHERE sr.status='active'
         GROUP BY sr.id
         ORDER BY total_sales DESC`,
        params
      );

      const enriched = rows.map((r) => ({
        ...r,
        achievement_pct:
          Number(r.target_amount) > 0
            ? Math.min(Math.round((Number(r.total_sales) / Number(r.target_amount)) * 100), 999)
            : 0,
        commission_earned:
          (Number(r.total_sales) * Number(r.commission_percentage)) / 100,
      }));

      res.json({ month: month || null, performance: enriched });
    } catch (err) {
      console.error("GET SALES PERFORMANCE ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/sales/leaderboard", authRequired, adminOnly, async (req, res) => {
    try {
      const periodClause = "AND DATE_FORMAT(o.created_at,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')";
      const [rows] = await pool.query(
        `SELECT sr.id, sr.name, COALESCE(SUM(o.total_amount - o.discount),0) AS total_sales,
                COUNT(DISTINCT o.id) AS orders_count,
                COALESCE(sr.target_amount,0) AS target_amount
         FROM sales_representatives sr
         LEFT JOIN retailers r ON r.sales_rep_id = sr.id
         LEFT JOIN orders o ON o.retailer_id = r.id ${periodClause}
         WHERE sr.status='active'
         GROUP BY sr.id
         ORDER BY total_sales DESC
         LIMIT 20`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET LEADERBOARD ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/sales/commissions", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT sc.*, sr.name AS sales_rep_name, o.retailer_id
         FROM sales_commissions sc
         JOIN sales_representatives sr ON sr.id = sc.sales_rep_id
         LEFT JOIN orders o ON o.id = sc.order_id
         ORDER BY sc.created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET COMMISSIONS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/sales/commissions/pay", authRequired, adminOnly, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Select commissions to pay" });
      }
      await pool.query(
        `UPDATE sales_commissions SET status='paid' WHERE id IN (?)`,
        [ids]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("PAY COMMISSION ERROR:", err);
      res.status(500).json({ error: "Failed to pay commission" });
    }
  });

  /* =====================================================
     PHASE 2 - TERRITORY MANAGEMENT
  ===================================================== */

  app.get("/api/territories", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT t.*, COALESCE(sr.name,'') AS manager_name
         FROM territories t
         LEFT JOIN sales_representatives sr ON sr.id = t.manager_id
         ORDER BY t.name ASC`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET TERRITORIES ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/territories", authRequired, adminOnly, async (req, res) => {
    try {
      const { name, code, state, district, city, description, manager_id, status = "active" } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name is required" });
      }
      const [r] = await pool.query(
        `INSERT INTO territories (name, code, state, district, city, description, manager_id, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        [name.trim(), code || null, state || null, district || null, city || null,
         description || null, manager_id || null, status]
      );
      res.status(201).json({ success: true, id: r.insertId });
    } catch (err) {
      console.error("CREATE TERRITORY ERROR:", err);
      res.status(500).json({ error: "Failed to create territory" });
    }
  });

  app.put("/api/territories/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const { name, code, state, district, city, description, manager_id, status } = req.body;
      await pool.query(
        `UPDATE territories SET name=?, code=?, state=?, district=?, city=?, description=?, manager_id=?, status=?
         WHERE id=?`,
        [name, code || null, state || null, district || null, city || null,
         description || null, manager_id || null, status || "active", req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("UPDATE TERRITORY ERROR:", err);
      res.status(500).json({ error: "Failed to update territory" });
    }
  });

  app.delete("/api/territories/:id", authRequired, adminOnly, async (req, res) => {
    try {
      await pool.query("UPDATE retailers SET territory_id=NULL WHERE territory_id=?", [req.params.id]);
      await pool.query("UPDATE sales_representatives SET territory_id=NULL WHERE territory_id=?", [req.params.id]);
      await pool.query("DELETE FROM territories WHERE id=?", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE TERRITORY ERROR:", err);
      res.status(500).json({ error: "Failed to delete territory" });
    }
  });

  app.get("/api/territories/performance", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT
           t.id, t.name,
           COUNT(DISTINCT r.id) AS total_retailers,
           COUNT(DISTINCT o.id) AS total_orders,
           COALESCE(SUM(o.total_amount - o.discount),0) AS revenue,
           COALESCE(SUM(CASE WHEN o.payment_status<>'paid' THEN o.total_amount - o.discount ELSE 0 END),0) AS pending_payments
         FROM territories t
         LEFT JOIN retailers r ON r.territory_id = t.id
         LEFT JOIN orders o ON o.retailer_id = r.id
         GROUP BY t.id
         ORDER BY revenue DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("TERRITORY PERFORMANCE ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/territories/:id/products", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT p.name AS product_name, SUM(oi.quantity) AS total_qty, SUM(oi.quantity * oi.price) AS revenue
         FROM products p
         JOIN order_items oi ON oi.product_id = p.id
         JOIN orders o ON o.id = oi.order_id
         JOIN retailers r ON r.id = o.retailer_id
         WHERE r.territory_id = ?
         GROUP BY p.id
         ORDER BY total_qty DESC
         LIMIT 5`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      console.error("TERRITORY PRODUCTS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* =====================================================
     PHASE 3 - PURCHASE ORDERS
  ===================================================== */

  app.get("/api/purchase-orders", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT po.*, s.company_name AS supplier_name
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         ORDER BY po.created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET PURCHASE ORDERS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/purchase-orders", authRequired, adminOnly, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const {
        supplier_id, order_date, expected_delivery, items = [],
        status = "draft", notes,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Add at least one product" });
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
        [poNumber, supplier_id || null, order_date || null, expected_delivery || null,
         total, status, notes || null, req.user.id]
      );
      const poId = r.insertId;

      for (const it of items) {
        await connection.query(
          `INSERT INTO purchase_order_items
           (purchase_order_id, product_id, quantity, purchase_price, total)
           VALUES (?,?,?,?,?)`,
          [poId, it.product_id, Number(it.quantity), Number(it.purchase_price || 0),
           Number(it.quantity) * Number(it.purchase_price || 0)]
        );
      }

      await connection.commit();
      res.status(201).json({ success: true, id: poId, po_number: poNumber });
    } catch (err) {
      await connection.rollback();
      console.error("CREATE PURCHASE ORDER ERROR:", err);
      res.status(500).json({ error: "Failed to create purchase order" });
    } finally {
      connection.release();
    }
  });

  app.get("/api/purchase-orders/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const [[po]] = await pool.query(
        `SELECT po.*, s.company_name AS supplier_name
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.id=?`,
        [req.params.id]
      );
      if (!po) return res.status(404).json({ error: "Purchase order not found" });

      const [items] = await pool.query(
        `SELECT poi.*, p.name AS product_name, p.sku
         FROM purchase_order_items poi
         JOIN products p ON p.id = poi.product_id
         WHERE poi.purchase_order_id=?`,
        [req.params.id]
      );
      res.json({ purchase_order: po, items });
    } catch (err) {
      console.error("GET PURCHASE ORDER ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/purchase-orders/:id", authRequired, adminOnly, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { supplier_id, order_date, expected_delivery, items, status, notes } = req.body;
      await connection.beginTransaction();

      await connection.query(
        `UPDATE purchase_orders SET supplier_id=?, order_date=?, expected_delivery=?, status=?, notes=?
         WHERE id=?`,
        [supplier_id || null, order_date || null, expected_delivery || null,
         status || "draft", notes || null, req.params.id]
      );

      if (Array.isArray(items) && items.length > 0) {
        // Only allow product edits while draft/sent (not after receipt)
        const [[po]] = await connection.query("SELECT status FROM purchase_orders WHERE id=?", [req.params.id]);
        if (["received", "partially_received"].includes(po.status)) {
          await connection.rollback();
          return res.status(400).json({ error: "Cannot edit items after products received" });
        }
        await connection.query("DELETE FROM purchase_order_items WHERE purchase_order_id=?", [req.params.id]);
        let total = 0;
        for (const it of items) {
          total += Number(it.quantity || 0) * Number(it.purchase_price || 0);
          await connection.query(
            `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, purchase_price, total)
             VALUES (?,?,?,?,?)`,
            [req.params.id, it.product_id, Number(it.quantity), Number(it.purchase_price || 0),
             Number(it.quantity) * Number(it.purchase_price || 0)]
          );
        }
        await connection.query("UPDATE purchase_orders SET total_amount=? WHERE id=?", [total, req.params.id]);
      }

      await connection.commit();
      res.json({ success: true });
    } catch (err) {
      await connection.rollback();
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      console.error("UPDATE PURCHASE ORDER ERROR:", err);
      res.status(500).json({ error: "Failed to update purchase order" });
    } finally {
      connection.release();
    }
  });

  app.post("/api/purchase-orders/:id/status", authRequired, adminOnly, async (req, res) => {
    try {
      const { status } = req.body;
      const allowed = ["draft", "sent", "confirmed", "cancelled"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      await pool.query("UPDATE purchase_orders SET status=? WHERE id=?", [status, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error("UPDATE PO STATUS ERROR:", err);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  /* ---- Receive products (stock in + inventory movement + prevent duplicates) ---- */

  app.post("/api/purchase-orders/:id/receive", authRequired, adminOnly, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const poId = req.params.id;
      const { quantities } = req.body; // { [purchase_order_item_id]: qtyReceived }

      await connection.beginTransaction();

      const [[po]] = await connection.query(
        "SELECT * FROM purchase_orders WHERE id=? FOR UPDATE",
        [poId]
      );
      if (!po) throw Object.assign(new Error("Purchase order not found"), { statusCode: 404 });

      const [items] = await connection.query(
        "SELECT * FROM purchase_order_items WHERE purchase_order_id=?",
        [poId]
      );
      if (!items.length) throw Object.assign(new Error("No items on this purchase order"), { statusCode: 400 });

      // Build stock_in record
      const [stockRes] = await connection.query(
        `INSERT INTO stock_in (supplier_id, notes, total_amount, created_by)
         VALUES (?,?,?,?)`,
        [po.supplier_id, `Received from PO ${po.po_number}`, po.total_amount, req.user.id]
      );
      const stockInId = stockRes.insertId;

      let totalReceived = 0;

      for (const item of items) {
        const requested = Number(quantities && quantities[item.id] != null ? quantities[item.id] : item.quantity);
        const alreadyReceived = Number(item.received_qty || 0);
        const remaining = Number(item.quantity) - alreadyReceived;

        if (requested <= 0 || requested > remaining) {
          throw Object.assign(new Error(
            `Cannot receive ${requested} for item #${item.id}; remaining ${remaining}`
          ), { statusCode: 400 });
        }

        // stock_in_item
        await connection.query(
          `INSERT INTO stock_in_items (stock_in_id, product_id, quantity, purchase_price)
           VALUES (?,?,?,?)`,
          [stockInId, item.product_id, requested, item.purchase_price]
        );

        // update product stock
        const [[prod]] = await connection.query(
          "SELECT stock FROM products WHERE id=? FOR UPDATE",
          [item.product_id]
        );
        const prevStock = Number(prod.stock || 0);
        const newStock = prevStock + requested;
        await connection.query(
          "UPDATE products SET stock=?, distributor_price=COALESCE(?, distributor_price) WHERE id=?",
          [newStock, item.purchase_price, item.product_id]
        );

        // inventory movement (IN)
        await connection.query(
          `INSERT INTO inventory_movements
           (product_id, movement_type, quantity, prev_stock, new_stock,
            reference_type, reference_id, reason, created_by)
           VALUES (?, 'IN', ?, ?, ?, 'PURCHASE_ORDER', ?, ?, ?)`,
          [item.product_id, requested, prevStock, newStock, poId, `PO receive` , req.user.id]
        );

        // mark received
        const newReceived = alreadyReceived + requested;
        totalReceived += newReceived;
        await connection.query(
          "UPDATE purchase_order_items SET received_qty=? WHERE id=?",
          [newReceived, item.id]
        );
      }

      // Determine PO status
      const fully = items.every((it) =>
        Number(it.received_qty) + Number(quantities && quantities[it.id] != null ? quantities[it.id] : it.quantity) >= Number(it.quantity)
      );
      await connection.query(
        "UPDATE purchase_orders SET status=? WHERE id=?",
        [fully ? "received" : "partially_received", poId]
      );

      await connection.commit();
      res.json({ success: true, stock_in_id: stockInId, status: fully ? "received" : "partially_received" });
    } catch (err) {
      await connection.rollback();
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      console.error("RECEIVE PURCHASE ORDER ERROR:", err);
      res.status(500).json({ error: "Failed to receive products" });
    } finally {
      connection.release();
    }
  });

  /* =====================================================
     PHASE 4 - RETURNS MANAGEMENT
  ===================================================== */

  // Customer / Retailer: create a return request scoped to their orders
  app.post("/api/returns", authRequired, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const {
        order_id, retailer_id, supplier_id, return_type = "retailer",
        reason, items = [],
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Add at least one return item" });
      }

      // Security: customers can only return their own orders
      let effectiveRetailerId = retailer_id || null;
      if (req.user.role === "customer") {
        if (!order_id) {
          return res.status(400).json({ error: "Order is required" });
        }
        const [[order]] = await pool.query(
          "SELECT o.id, o.retailer_id, o.status FROM orders o WHERE o.id=?",
          [order_id]
        );
        if (!order) return res.status(404).json({ error: "Order not found" });
        const [[owner]] = await pool.query(
          "SELECT user_id FROM retailers WHERE id=?",
          [order.retailer_id]
        );
        if (!owner || owner.user_id !== req.user.id) {
          return res.status(403).json({ error: "You can only return your own orders" });
        }
        if (["delivered", "completed"].includes(order.status) === false) {
          return res.status(400).json({ error: "Only delivered/completed orders can be returned" });
        }
        effectiveRetailerId = order.retailer_id;
      }

      await connection.beginTransaction();

      const returnNumber = `RET-${Date.now().toString().slice(-6)}`;
      let total = 0;
      const validItems = [];
      for (const it of items) {
        const qty = Number(it.quantity || 0);
        const price = Number(it.price || 0);
        if (qty <= 0) continue;
        total += qty * price;
        validItems.push({ product_id: it.product_id, quantity: qty, price, condition: it.condition || "good" });
      }
      if (!validItems.length) {
        await connection.rollback();
        return res.status(400).json({ error: "No valid return items" });
      }

      const [r] = await connection.query(
        `INSERT INTO returns
         (return_number, order_id, retailer_id, supplier_id, return_type, reason, status, total_amount, created_by)
         VALUES (?,?,?,?,?,?, 'requested', ?, ?)`,
        [returnNumber, order_id || null, effectiveRetailerId, supplier_id || null,
         return_type, reason || null, total, req.user.id]
      );
      const returnId = r.insertId;

      for (const it of validItems) {
        await connection.query(
          `INSERT INTO return_items (return_id, product_id, quantity, price, item_condition)
           VALUES (?,?,?,?,?)`,
          [returnId, it.product_id, it.quantity, it.price, it.condition]
        );
      }

      await connection.commit();
      // Non-breaking hooks: notify admins + audit
      try {
        const [admins] = await pool.query("SELECT id FROM users WHERE role='admin'");
        for (const a of admins) {
          await createNotification(pool, {
            userId: a.id,
            title: "Return Request",
            message: `Return request ${returnNumber} for ₹${total}`,
            type: "return",
            referenceType: "return",
            referenceId: returnId,
          });
        }
        await logActivity(pool, {
          userId: req.user.id,
          action: "CREATE",
          module: "RETURN",
          description: `Created return ${returnNumber} (₹${total})`,
          referenceType: "return",
          referenceId: returnId,
          ipAddress: req.ip,
        });
      } catch (hookErr) {
        console.error("RETURN NOTIFY/AUDIT ERROR:", hookErr);
      }
      res.status(201).json({ success: true, id: returnId, return_number: returnNumber });
    } catch (err) {
      await connection.rollback();
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      console.error("CREATE RETURN ERROR:", err);
      res.status(403).json({ error: "Failed to create return" });
    } finally {
      connection.release();
    }
  });

  // Customer: list their own returns
  app.get("/api/returns/mine", authRequired, async (req, res) => {
    try {
      if (req.user.role === "admin") {
        return res.status(403).json({ error: "Use admin returns endpoint" });
      }
      const [[ret]] = await pool.query(
        "SELECT id FROM retailers WHERE user_id=?",
        [req.user.id]
      );
      if (!ret) return res.json([]);
      const [rows] = await pool.query(
        `SELECT r.*, inv.invoice_no
         FROM returns r
         LEFT JOIN orders o ON o.id = r.order_id
         LEFT JOIN invoices inv ON inv.order_id = o.id
         WHERE r.retailer_id=?
         ORDER BY r.created_at DESC`,
        [ret.id]
      );
      res.json(rows);
    } catch (err) {
      console.error("GET MY RETURNS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin: list all returns
  app.get("/api/returns", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT r.*, COALESCE(rt.shop_name, rt.name) AS retailer_name, s.company_name AS supplier_name
         FROM returns r
         LEFT JOIN retailers rt ON rt.id = r.retailer_id
         LEFT JOIN suppliers s ON s.id = r.supplier_id
         ORDER BY r.created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET RETURNS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/returns/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const [[ret]] = await pool.query(
        `SELECT r.*, COALESCE(rt.shop_name, rt.name) AS retailer_name, s.company_name AS supplier_name
         FROM returns r
         LEFT JOIN retailers rt ON rt.id = r.retailer_id
         LEFT JOIN suppliers s ON s.id = r.supplier_id
         WHERE r.id=?`,
        [req.params.id]
      );
      if (!ret) return res.status(404).json({ error: "Return not found" });
      const [items] = await pool.query(
        `SELECT ri.*, p.name AS product_name, p.sku
         FROM return_items ri
         JOIN products p ON p.id = ri.product_id
         WHERE ri.return_id=?`,
        [req.params.id]
      );
      res.json({ return: ret, items });
    } catch (err) {
      console.error("GET RETURN ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin: approve / reject / receive / refund a return (with stock restock on receive)
  app.put("/api/returns/:id/status", authRequired, adminOnly, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { status } = req.body;
      const allowed = ["approved", "rejected", "received", "refunded"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      await connection.beginTransaction();

      const [[ret]] = await connection.query(
        "SELECT * FROM returns WHERE id=? FOR UPDATE",
        [req.params.id]
      );
      if (!ret) throw Object.assign(new Error("Return not found"), { statusCode: 404 });

      // Prevent re-processing a return that has already been received/refunded
      if (["received", "refunded"].includes(ret.status)) {
        await connection.rollback();
        return res.status(400).json({ error: "Return already processed" });
      }

      // When receiving, restock goods or record damaged/expired inventory
      if (status === "received") {
        const [items] = await connection.query(
          "SELECT * FROM return_items WHERE return_id=?",
          [req.params.id]
        );
        for (const it of items) {
          const [[prod]] = await connection.query(
            "SELECT stock FROM products WHERE id=? FOR UPDATE",
            [it.product_id]
          );
          const prevStock = Number(prod.stock || 0);

          if (it.item_condition === "good") {
            const newStock = prevStock + Number(it.quantity);
            await connection.query("UPDATE products SET stock=? WHERE id=?", [newStock, it.product_id]);
            await connection.query(
              `INSERT INTO inventory_movements
               (product_id, movement_type, quantity, prev_stock, new_stock, reference_type, reference_id, reason, created_by)
               VALUES (?, 'RETURN_IN', ?, ?, ?, 'RETURN', ?, ?, ?)`,
              [it.product_id, it.quantity, prevStock, newStock, req.params.id, "Restock from return", req.user.id]
            );
          } else if (it.item_condition === "damaged") {
            await connection.query(
              `INSERT INTO damaged_inventory (product_id, quantity, source, reference_type, reference_id, created_by)
               VALUES (?,?, 'return', 'RETURN', ?, ?)`,
              [it.product_id, it.quantity, req.params.id, req.user.id]
            );
            await connection.query(
              `INSERT INTO inventory_movements
               (product_id, movement_type, quantity, prev_stock, new_stock, reference_type, reference_id, reason, created_by)
               VALUES (?, 'DAMAGED', ?, ?, ?, 'RETURN', ?, ?, ?)`,
              [it.product_id, it.quantity, prevStock, prevStock, req.params.id, "Damaged from return", req.user.id]
            );
          } else if (it.item_condition === "expired") {
            await connection.query(
              `INSERT INTO expired_inventory (product_id, quantity, source, reference_type, reference_id, created_by)
               VALUES (?,?, 'return', 'RETURN', ?, ?)`,
              [it.product_id, it.quantity, req.params.id, req.user.id]
            );
            await connection.query(
              `INSERT INTO inventory_movements
               (product_id, movement_type, quantity, prev_stock, new_stock, reference_type, reference_id, reason, created_by)
               VALUES (?, 'EXPIRED', ?, ?, ?, 'RETURN', ?, ?, ?)`,
              [it.product_id, it.quantity, prevStock, prevStock, req.params.id, "Expired from return", req.user.id]
            );
          }
        }
      }

      await connection.query(
        "UPDATE returns SET status=? WHERE id=?",
        [status, req.params.id]
      );

      await connection.commit();
      // Non-breaking hooks: notify retailer + audit
      try {
        const [[owner]] = await pool.query(
          "SELECT user_id FROM retailers WHERE id=?",
          [ret.retailer_id]
        );
        if (owner?.user_id) {
          await createNotification(pool, {
            userId: owner.user_id,
            title: `Return ${status[0].toUpperCase() + status.slice(1)}`,
            message: `Your return ${ret.return_number} is now '${status}'`,
            type: "return",
            referenceType: "return",
            referenceId: ret.id,
          });
        }
        await logActivity(pool, {
          userId: req.user.id,
          action: "UPDATE",
          module: "RETURN",
          description: `Return ${ret.return_number} status changed to '${status}'`,
          referenceType: "return",
          referenceId: ret.id,
          ipAddress: req.ip,
        });
      } catch (hookErr) {
        console.error("RETURN STATUS NOTIFY/AUDIT ERROR:", hookErr);
      }
      res.json({ success: true });
    } catch (err) {
      await connection.rollback();
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      console.error("UPDATE RETURN STATUS ERROR:", err);
      res.status(500).json({ error: "Failed to update return status" });
    } finally {
      connection.release();
    }
  });

  /* =====================================================
     PHASE 5 - DAMAGED / EXPIRED INVENTORY & EXPIRY ALERTS
  ===================================================== */

  app.get("/api/inventory/damaged", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT di.*, p.name AS product_name, p.sku
         FROM damaged_inventory di
         JOIN products p ON p.id = di.product_id
         ORDER BY di.created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET DAMAGED ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/inventory/expired", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT ei.*, p.name AS product_name, p.sku
         FROM expired_inventory ei
         JOIN products p ON p.id = ei.product_id
         ORDER BY ei.created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET EXPIRED ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Products expiring within the next N days
  app.get("/api/inventory/expiry-alerts", authRequired, adminOnly, async (req, res) => {
    try {
      const days = Number(req.query.days) || 30;
      const [rows] = await pool.query(
        `SELECT p.id, p.name, p.sku, p.stock, p.expiry_date,
                DATEDIFF(p.expiry_date, CURDATE()) AS days_left
         FROM products p
         WHERE p.expiry_date IS NOT NULL
           AND p.expiry_date >= CURDATE()
           AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
         ORDER BY p.expiry_date ASC`,
        [days]
      );
      res.json(rows);
    } catch (err) {
      console.error("GET EXPIRY ALERTS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Products already expired
  app.get("/api/inventory/expired-products", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT p.id, p.name, p.sku, p.stock, p.expiry_date
         FROM products p
         WHERE p.expiry_date IS NOT NULL AND p.expiry_date < CURDATE()
         ORDER BY p.expiry_date ASC`
      );
      res.json(rows);
    } catch (err) {
      console.error("GET EXPIRED PRODUCTS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
}

export { registerDmsAdvancedRoutes as registerDmsAdvancedRoutes };
