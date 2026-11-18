import express from "express";

export default function registerDeliveryRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  // Customer-facing route (auth required, not adminOnly)
  app.get("/api/deliveries/customer/:orderId", authRequired, async (req, res) => {
    try {
      const { orderId } = req.params;
      const userId = req.user.id;
      const role = req.user.role;

      let sql = `
        SELECT d.*, o.total_amount, o.customer_name, o.shipping_address
        FROM deliveries d
        JOIN orders o ON d.order_id = o.id
        WHERE d.order_id = ?
      `;
      const params = [orderId];

      if (role !== "admin" && role !== "superadmin") {
        sql += " AND o.user_id = ?";
        params.push(userId);
      }

      const [rows] = await pool.query(sql, params);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Delivery not found for this order" });
      }
      res.json(rows[0]);
    } catch (error) {
      console.error("Get customer delivery error:", error);
      res.status(500).json({ message: "Failed to fetch delivery", error: error.message });
    }
  });

  // Delivery dashboard
  router.get("/dashboard", async (req, res) => {
    try {
      const [totalRows] = await pool.query("SELECT COUNT(*) AS total FROM deliveries");
      const [pendingRows] = await pool.query("SELECT COUNT(*) AS total FROM deliveries WHERE delivery_status = 'ready'");
      const [outRows] = await pool.query("SELECT COUNT(*) AS total FROM deliveries WHERE delivery_status = 'out_for_delivery'");
      const [deliveredTodayRows] = await pool.query(
        "SELECT COUNT(*) AS total FROM deliveries WHERE delivery_status = 'delivered' AND delivered_date = CURDATE()"
      );
      const [deliveredTotalRows] = await pool.query("SELECT COUNT(*) AS total FROM deliveries WHERE delivery_status = 'delivered'");
      const [failedRows] = await pool.query("SELECT COUNT(*) AS total FROM deliveries WHERE delivery_status = 'failed'");

      const [todayDeliveries] = await pool.query(`
        SELECT d.*, o.total_amount, o.customer_name
        FROM deliveries d
        JOIN orders o ON d.order_id = o.id
        WHERE d.expected_delivery = CURDATE()
        ORDER BY d.delivery_status ASC
      `);

      res.json({
        total: totalRows[0].total,
        pending: pendingRows[0].total,
        out_for_delivery: outRows[0].total,
        delivered_today: deliveredTodayRows[0].total,
        delivered_total: deliveredTotalRows[0].total,
        failed: failedRows[0].total,
        today_deliveries: todayDeliveries,
      });
    } catch (error) {
      console.error("Delivery dashboard error:", error);
      res.status(500).json({ message: "Failed to fetch dashboard", error: error.message });
    }
  });

  // List delivery persons
  router.get("/persons", async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT * FROM delivery_persons WHERE status = 'active' ORDER BY name ASC");
      res.json(rows);
    } catch (error) {
      console.error("List delivery persons error:", error);
      res.status(500).json({ message: "Failed to fetch delivery persons", error: error.message });
    }
  });

  // Create delivery person
  router.post("/persons", async (req, res) => {
    try {
      const { user_id, name, phone, vehicle_number, vehicle_type } = req.body;
      if (!name || !phone) {
        return res.status(400).json({ message: "Name and phone are required" });
      }
      const [result] = await pool.query(
        "INSERT INTO delivery_persons (user_id, name, phone, vehicle_number, vehicle_type, status) VALUES (?, ?, ?, ?, ?, 'active')",
        [user_id || null, name, phone, vehicle_number || null, vehicle_type || null]
      );
      const [rows] = await pool.query("SELECT * FROM delivery_persons WHERE id = ?", [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error("Create delivery person error:", error);
      res.status(500).json({ message: "Failed to create delivery person", error: error.message });
    }
  });

  // Update delivery person
  router.put("/persons/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, phone, vehicle_number, vehicle_type, status } = req.body;

      const [existing] = await pool.query("SELECT * FROM delivery_persons WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ message: "Delivery person not found" });
      }

      await pool.query(
        "UPDATE delivery_persons SET name = COALESCE(?, name), phone = COALESCE(?, phone), vehicle_number = COALESCE(?, vehicle_number), vehicle_type = COALESCE(?, vehicle_type), status = COALESCE(?, status) WHERE id = ?",
        [name, phone, vehicle_number, vehicle_type, status, id]
      );
      const [rows] = await pool.query("SELECT * FROM delivery_persons WHERE id = ?", [id]);
      res.json(rows[0]);
    } catch (error) {
      console.error("Update delivery person error:", error);
      res.status(500).json({ message: "Failed to update delivery person", error: error.message });
    }
  });

  // Soft delete delivery person
  router.delete("/persons/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [existing] = await pool.query("SELECT * FROM delivery_persons WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ message: "Delivery person not found" });
      }
      await pool.query("UPDATE delivery_persons SET status = 'inactive' WHERE id = ?", [id]);
      res.json({ message: "Delivery person deactivated successfully" });
    } catch (error) {
      console.error("Delete delivery person error:", error);
      res.status(500).json({ message: "Failed to deactivate delivery person", error: error.message });
    }
  });

  // List all deliveries with order info
  router.get("/", async (req, res) => {
    try {
      const { status } = req.query;
      let sql = `
        SELECT d.*, o.total_amount, o.customer_name, o.shipping_address
        FROM deliveries d
        JOIN orders o ON d.order_id = o.id
      `;
      const params = [];

      if (status) {
        sql += " WHERE d.delivery_status = ?";
        params.push(status);
      }
      sql += " ORDER BY d.created_at DESC";

      const [rows] = await pool.query(sql, params);
      res.json(rows);
    } catch (error) {
      console.error("List deliveries error:", error);
      res.status(500).json({ message: "Failed to fetch deliveries", error: error.message });
    }
  });

  // Get delivery detail
  router.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(`
        SELECT d.*, o.total_amount, o.customer_name, o.shipping_address, o.shipping_city, o.shipping_state, o.shipping_pincode
        FROM deliveries d
        JOIN orders o ON d.order_id = o.id
        WHERE d.id = ?
      `, [id]);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Delivery not found" });
      }
      res.json(rows[0]);
    } catch (error) {
      console.error("Get delivery error:", error);
      res.status(500).json({ message: "Failed to fetch delivery", error: error.message });
    }
  });

  // Create delivery from order
  router.post("/", async (req, res) => {
    try {
      const { order_id, delivery_person, delivery_phone, vehicle_number, dispatch_date, expected_delivery, notes } = req.body;
      if (!order_id) {
        return res.status(400).json({ message: "order_id is required" });
      }

      const [orderRows] = await pool.query("SELECT * FROM orders WHERE id = ?", [order_id]);
      if (orderRows.length === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      const order = orderRows[0];

      const [existing] = await pool.query("SELECT id FROM deliveries WHERE order_id = ?", [order_id]);
      if (existing.length > 0) {
        return res.status(400).json({ message: "Delivery already exists for this order" });
      }

      const [maxRow] = await pool.query("SELECT MAX(CAST(SUBSTRING(delivery_number, 5) AS UNSIGNED)) AS maxNum FROM deliveries WHERE delivery_number LIKE 'DEL-%'");
      const nextNum = (maxRow[0].maxNum || 0) + 1;
      const delivery_number = "DEL-" + String(nextNum).padStart(6, "0");

      const delivery_address = [order.shipping_address, order.shipping_city, order.shipping_state, order.shipping_pincode]
        .filter(Boolean)
        .join(", ");

      const [result] = await pool.query(
        `INSERT INTO deliveries (delivery_number, order_id, delivery_person, delivery_phone, vehicle_number, dispatch_date, expected_delivery, delivery_status, delivery_address, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
        [
          delivery_number,
          order_id,
          delivery_person || null,
          delivery_phone || null,
          vehicle_number || null,
          dispatch_date || null,
          expected_delivery || null,
          delivery_address,
          notes || null,
          req.user.id,
        ]
      );

      const [rows] = await pool.query("SELECT * FROM deliveries WHERE id = ?", [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error("Create delivery error:", error);
      res.status(500).json({ message: "Failed to create delivery", error: error.message });
    }
  });

  // Update delivery status with flow validation
  router.put("/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { delivery_status, notes } = req.body;

      const [existing] = await pool.query("SELECT * FROM deliveries WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ message: "Delivery not found" });
      }

      const current = existing[0].delivery_status;
      const validTransitions = {
        ready: ["dispatched"],
        dispatched: ["out_for_delivery", "failed"],
        out_for_delivery: ["delivered"],
      };

      if (!validTransitions[current] || !validTransitions[current].includes(delivery_status)) {
        return res.status(400).json({ message: `Invalid status transition from '${current}' to '${delivery_status}'` });
      }

      if (delivery_status === "failed" && !notes) {
        return res.status(400).json({ message: "Notes are required when marking delivery as failed" });
      }

      let sql = "UPDATE deliveries SET delivery_status = ?";
      const params = [delivery_status];

      if (delivery_status === "delivered") {
        sql += ", delivered_date = CURDATE()";
      }
      if (notes) {
        sql += ", notes = ?";
        params.push(notes);
      }
      sql += " WHERE id = ?";
      params.push(id);

      await pool.query(sql, params);
      const [rows] = await pool.query("SELECT * FROM deliveries WHERE id = ?", [id]);
      res.json(rows[0]);
    } catch (error) {
      console.error("Update delivery status error:", error);
      res.status(500).json({ message: "Failed to update delivery status", error: error.message });
    }
  });

  app.use("/api/deliveries", authRequired, adminOnly, router);
}
