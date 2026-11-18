import express from "express";

export default function registerSalesRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();
  const visitsRouter = express.Router();

  // ── SALES ROUTES ──

  router.get("/", async (req, res) => {
    try {
      const { sales_rep_id, date, status } = req.query;
      let where = ["1=1"];
      const params = [];
      if (sales_rep_id) { where.push("sr.sales_rep_id = ?"); params.push(sales_rep_id); }
      if (date) { where.push("sr.route_date = ?"); params.push(date); }
      if (status) { where.push("sr.status = ?"); params.push(status); }

      const [routes] = await pool.query(
        `SELECT sr.*, rep.name AS sales_rep_name,
                COUNT(rst.id) AS total_stops,
                SUM(CASE WHEN rst.status = 'completed' THEN 1 ELSE 0 END) AS completed_stops
         FROM sales_routes sr
         LEFT JOIN sales_representatives rep ON rep.id = sr.sales_rep_id
         LEFT JOIN sales_route_stops rst ON rst.route_id = sr.id
         WHERE ${where.join(" AND ")}
         GROUP BY sr.id
         ORDER BY sr.route_date DESC`,
        params
      );
      res.json(routes);
    } catch (err) {
      console.error("List routes error:", err);
      res.status(500).json({ error: "Failed to list routes" });
    }
  });

  router.post("/", async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { sales_rep_id, route_date, stops, notes } = req.body;
      if (!sales_rep_id || !route_date || !stops?.length) {
        return res.status(400).json({ error: "sales_rep_id, route_date, stops required" });
      }

      const [cnt] = await conn.query("SELECT COUNT(*) AS c FROM sales_routes WHERE route_date = ?", [route_date]);
      const seq = String(cnt[0].c + 1).padStart(3, "0");
      const route_code = `RT-${route_date.replace(/-/g, "")}-${seq}`;

      const [routeResult] = await conn.query(
        "INSERT INTO sales_routes (route_code, sales_rep_id, route_date, status, notes, created_by) VALUES (?, ?, ?, 'planned', ?, ?)",
        [route_code, sales_rep_id, route_date, notes || null, req.user?.id || null]
      );
      const routeId = routeResult.insertId;

      for (const stop of stops) {
        await conn.query(
          "INSERT INTO sales_route_stops (route_id, retailer_id, stop_order, status) VALUES (?, ?, ?, 'pending')",
          [routeId, stop.retailer_id, stop.stop_order]
        );
      }

      await conn.commit();
      res.status(201).json({ id: routeId, route_code, message: "Route created" });
    } catch (err) {
      await conn.rollback();
      console.error("Create route error:", err);
      res.status(500).json({ error: "Failed to create route" });
    } finally {
      conn.release();
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [routes] = await pool.query(
        `SELECT sr.*, rep.name AS sales_rep_name
         FROM sales_routes sr
         LEFT JOIN sales_representatives rep ON rep.id = sr.sales_rep_id
         WHERE sr.id = ?`,
        [id]
      );
      if (routes.length === 0) return res.status(404).json({ error: "Route not found" });

      const [stops] = await pool.query(
        `SELECT rst.*, r.name AS retailer_name
         FROM sales_route_stops rst
         LEFT JOIN retailers r ON r.id = rst.retailer_id
         WHERE rst.route_id = ?
         ORDER BY rst.stop_order`,
        [id]
      );

      const [visits] = await pool.query(
        "SELECT * FROM retailer_visits WHERE route_id = ?",
        [id]
      );

      res.json({ ...routes[0], stops, visits });
    } catch (err) {
      console.error("Route detail error:", err);
      res.status(500).json({ error: "Failed to get route" });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { notes, status } = req.body;
      const fields = [];
      const params = [];
      if (notes !== undefined) { fields.push("notes = ?"); params.push(notes); }
      if (status !== undefined) { fields.push("status = ?"); params.push(status); }
      if (fields.length === 0) return res.status(400).json({ error: "Nothing to update" });
      params.push(id);
      await pool.query(`UPDATE sales_routes SET ${fields.join(", ")} WHERE id = ?`, params);
      res.json({ message: "Route updated" });
    } catch (err) {
      console.error("Update route error:", err);
      res.status(500).json({ error: "Failed to update route" });
    }
  });

  router.put("/:id/reorder", async (req, res) => {
    try {
      const { stops } = req.body;
      if (!stops?.length) return res.status(400).json({ error: "stops required" });
      for (const stop of stops) {
        await pool.query("UPDATE sales_route_stops SET stop_order = ? WHERE id = ?", [stop.stop_order, stop.id]);
      }
      res.json({ message: "Stops reordered" });
    } catch (err) {
      console.error("Reorder error:", err);
      res.status(500).json({ error: "Failed to reorder stops" });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query("UPDATE sales_routes SET status = 'cancelled' WHERE id = ?", [id]);
      await pool.query("UPDATE sales_route_stops SET status = 'cancelled' WHERE route_id = ? AND status = 'pending'", [id]);
      res.json({ message: "Route cancelled" });
    } catch (err) {
      console.error("Delete route error:", err);
      res.status(500).json({ error: "Failed to cancel route" });
    }
  });

  router.get("/:id/performance", async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(
        `SELECT
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           COUNT(*) AS total
         FROM sales_route_stops WHERE route_id = ?`,
        [id]
      );
      const [sales] = await pool.query(
        "SELECT COALESCE(SUM(sales_amount), 0) AS total_sales FROM retailer_visits WHERE route_id = ?",
        [id]
      );
      res.json({ ...rows[0], total_sales: sales[0].total_sales });
    } catch (err) {
      console.error("Performance error:", err);
      res.status(500).json({ error: "Failed to get performance" });
    }
  });

  // ── VISITS ──

  visitsRouter.get("/", async (req, res) => {
    try {
      const { date, sales_rep_id, status } = req.query;
      let where = ["1=1"];
      const params = [];
      if (date) { where.push("v.visit_date = ?"); params.push(date); }
      if (sales_rep_id) { where.push("v.sales_rep_id = ?"); params.push(sales_rep_id); }
      if (status) { where.push("v.status = ?"); params.push(status); }

      const [visits] = await pool.query(
        `SELECT v.*, r.name AS retailer_name, rep.name AS sales_rep_name
         FROM retailer_visits v
         LEFT JOIN retailers r ON r.id = v.retailer_id
         LEFT JOIN sales_representatives rep ON rep.id = v.sales_rep_id
         WHERE ${where.join(" AND ")}
         ORDER BY v.visit_date DESC, v.check_in_at DESC`,
        params
      );
      res.json(visits);
    } catch (err) {
      console.error("List visits error:", err);
      res.status(500).json({ error: "Failed to list visits" });
    }
  });

  visitsRouter.get("/dashboard", async (req, res) => {
    try {
      const [today] = await pool.query(
        `SELECT
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           COUNT(*) AS total
         FROM retailer_visits WHERE visit_date = CURDATE()`
      );

      const [week] = await pool.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(sales_amount), 0) AS total_sales,
                COALESCE(AVG(duration_minutes), 0) AS avg_duration
         FROM retailer_visits
         WHERE visit_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
      );

      const [byRep] = await pool.query(
        `SELECT rep.name AS sales_rep_name, COUNT(*) AS visits,
                SUM(CASE WHEN v.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                COALESCE(SUM(v.sales_amount), 0) AS sales
         FROM retailer_visits v
         LEFT JOIN sales_representatives rep ON rep.id = v.sales_rep_id
         WHERE v.visit_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         GROUP BY rep.id, rep.name`
      );

      res.json({ today: today[0], thisWeek: week[0], bySalesRep: byRep });
    } catch (err) {
      console.error("Visit dashboard error:", err);
      res.status(500).json({ error: "Failed to get dashboard" });
    }
  });

  visitsRouter.get("/rep/:salesRepId", async (req, res) => {
    try {
      const { salesRepId } = req.params;
      const { from, to } = req.query;
      let where = ["v.sales_rep_id = ?"];
      const params = [salesRepId];
      if (from) { where.push("v.visit_date >= ?"); params.push(from); }
      if (to) { where.push("v.visit_date <= ?"); params.push(to); }

      const [visits] = await pool.query(
        `SELECT v.*, r.name AS retailer_name
         FROM retailer_visits v
         LEFT JOIN retailers r ON r.id = v.retailer_id
         WHERE ${where.join(" AND ")}
         ORDER BY v.visit_date DESC`,
        params
      );
      res.json(visits);
    } catch (err) {
      console.error("Rep visits error:", err);
      res.status(500).json({ error: "Failed to get rep visits" });
    }
  });

  visitsRouter.post("/check-in", async (req, res) => {
    try {
      const { retailer_id, sales_rep_id, route_id, route_stop_id, notes, lat, lng } = req.body;
      if (!retailer_id || !sales_rep_id) return res.status(400).json({ error: "retailer_id and sales_rep_id required" });

      const [cnt] = await pool.query("SELECT COUNT(*) AS c FROM retailer_visits WHERE visit_date = CURDATE()");
      const seq = String(cnt[0].c + 1).padStart(3, "0");
      const visit_number = `VIS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${seq}`;

      const [result] = await pool.query(
        `INSERT INTO retailer_visits (visit_number, route_stop_id, route_id, retailer_id, sales_rep_id, visit_date, check_in_at, status, notes, lat, lng)
         VALUES (?, ?, ?, ?, ?, CURDATE(), NOW(), 'in_progress', ?, ?, ?)`,
        [visit_number, route_stop_id || null, route_id || null, retailer_id, sales_rep_id, notes || null, lat || null, lng || null]
      );

      if (route_stop_id) {
        await pool.query("UPDATE sales_route_stops SET status = 'completed', arrival_time = NOW() WHERE id = ?", [route_stop_id]);
      }

      res.status(201).json({ id: result.insertId, visit_number, message: "Checked in" });
    } catch (err) {
      console.error("Check-in error:", err);
      res.status(500).json({ error: "Failed to check in" });
    }
  });

  visitsRouter.put("/:id/check-out", async (req, res) => {
    try {
      const { id } = req.params;
      const { notes, order_id, sales_amount, follow_up_date } = req.body;
      await pool.query(
        `UPDATE retailer_visits
         SET check_out_at = NOW(),
             duration_minutes = TIMESTAMPDIFF(MINUTE, check_in_at, NOW()),
             status = 'completed',
             notes = COALESCE(?, notes),
             order_id = COALESCE(?, order_id),
             sales_amount = COALESCE(?, sales_amount),
             follow_up_date = COALESCE(?, follow_up_date)
         WHERE id = ?`,
        [notes || null, order_id || null, sales_amount || null, follow_up_date || null, id]
      );
      res.json({ message: "Checked out" });
    } catch (err) {
      console.error("Check-out error:", err);
      res.status(500).json({ error: "Failed to check out" });
    }
  });

  visitsRouter.put("/:id/skip", async (req, res) => {
    try {
      await pool.query("UPDATE retailer_visits SET status = 'skipped' WHERE id = ?", [req.params.id]);
      res.json({ message: "Visit skipped" });
    } catch (err) {
      console.error("Skip error:", err);
      res.status(500).json({ error: "Failed to skip visit" });
    }
  });

  visitsRouter.put("/:id/cancel", async (req, res) => {
    try {
      await pool.query("UPDATE retailer_visits SET status = 'cancelled' WHERE id = ?", [req.params.id]);
      res.json({ message: "Visit cancelled" });
    } catch (err) {
      console.error("Cancel error:", err);
      res.status(500).json({ error: "Failed to cancel visit" });
    }
  });

  visitsRouter.get("/:id", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT v.*, r.name AS retailer_name, rep.name AS sales_rep_name
         FROM retailer_visits v
         LEFT JOIN retailers r ON r.id = v.retailer_id
         LEFT JOIN sales_representatives rep ON rep.id = v.sales_rep_id
         WHERE v.id = ?`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Visit not found" });
      res.json(rows[0]);
    } catch (err) {
      console.error("Visit detail error:", err);
      res.status(500).json({ error: "Failed to get visit" });
    }
  });

  // ── MOUNT ──
  app.use("/api/sales-routes", authRequired, adminOnly, router);
  app.use("/api/visits", authRequired, adminOnly, visitsRouter);
}
