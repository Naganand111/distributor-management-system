import express from "express";

export default function registerWarehouseRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  // List warehouses with inventory counts
  router.get("/", async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT w.*,
          COUNT(wi.id) AS product_count,
          COALESCE(SUM(wi.quantity), 0) AS total_stock
        FROM warehouses w
        LEFT JOIN warehouse_inventory wi ON wi.warehouse_id = w.id
        GROUP BY w.id
        ORDER BY w.name ASC
      `);
      res.json(rows);
    } catch (error) {
      console.error("List warehouses error:", error);
      res.status(500).json({ message: "Failed to fetch warehouses", error: error.message });
    }
  });

  // Warehouse dashboard
  router.get("/dashboard", async (req, res) => {
    try {
      const [[whCount]] = await pool.query("SELECT COUNT(*) AS total FROM warehouses WHERE status = 'active'");
      const [[invCount]] = await pool.query("SELECT COALESCE(SUM(quantity), 0) AS total FROM warehouse_inventory");
      const [[pendingTransfers]] = await pool.query(
        "SELECT COUNT(*) AS total FROM stock_transfers WHERE status IN ('requested', 'approved')"
      );
      const [[inTransit]] = await pool.query(
        "SELECT COUNT(*) AS total FROM stock_transfers WHERE status = 'dispatched'"
      );

      res.json({
        total_warehouses: whCount.total,
        total_inventory: invCount.total,
        pending_transfers: pendingTransfers.total,
        in_transit_transfers: inTransit.total,
      });
    } catch (error) {
      console.error("Warehouse dashboard error:", error);
      res.status(500).json({ message: "Failed to fetch dashboard", error: error.message });
    }
  });

  // List transfers with warehouse names
  router.get("/transfers", async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT st.*,
          fw.name AS from_warehouse_name,
          tw.name AS to_warehouse_name,
          (SELECT COUNT(*) FROM stock_transfer_items WHERE transfer_id = st.id) AS item_count
        FROM stock_transfers st
        LEFT JOIN warehouses fw ON fw.id = st.from_warehouse_id
        LEFT JOIN warehouses tw ON tw.id = st.to_warehouse_id
        ORDER BY st.created_at DESC
      `);
      res.json(rows);
    } catch (error) {
      console.error("List transfers error:", error);
      res.status(500).json({ message: "Failed to fetch transfers", error: error.message });
    }
  });

  // Get transfer detail
  router.get("/transfers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [transferRows] = await pool.query(`
        SELECT st.*,
          fw.name AS from_warehouse_name,
          tw.name AS to_warehouse_name
        FROM stock_transfers st
        LEFT JOIN warehouses fw ON fw.id = st.from_warehouse_id
        LEFT JOIN warehouses tw ON tw.id = st.to_warehouse_id
        WHERE st.id = ?
      `, [id]);

      if (transferRows.length === 0) {
        return res.status(404).json({ message: "Transfer not found" });
      }

      const [items] = await pool.query(`
        SELECT sti.*, p.name AS product_name, p.sku
        FROM stock_transfer_items sti
        LEFT JOIN products p ON p.id = sti.product_id
        WHERE sti.transfer_id = ?
      `, [id]);

      res.json({ ...transferRows[0], items });
    } catch (error) {
      console.error("Get transfer error:", error);
      res.status(500).json({ message: "Failed to fetch transfer", error: error.message });
    }
  });

  // Get warehouse inventory
  router.get("/:id/inventory", async (req, res) => {
    try {
      const { id } = req.params;
      const [whRows] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [id]);
      if (whRows.length === 0) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      const [rows] = await pool.query(`
        SELECT wi.*, p.name AS product_name, p.sku, p.stock AS global_stock
        FROM warehouse_inventory wi
        LEFT JOIN products p ON p.id = wi.product_id
        WHERE wi.warehouse_id = ?
        ORDER BY p.name ASC
      `, [id]);

      res.json(rows);
    } catch (error) {
      console.error("Get warehouse inventory error:", error);
      res.status(500).json({ message: "Failed to fetch inventory", error: error.message });
    }
  });

  // Get single warehouse
  router.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [id]);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      res.json(rows[0]);
    } catch (error) {
      console.error("Get warehouse error:", error);
      res.status(500).json({ message: "Failed to fetch warehouse", error: error.message });
    }
  });

  // Create warehouse
  router.post("/", async (req, res) => {
    try {
      const { name, code, address, city, state, manager_name, phone } = req.body;
      if (!name || !code) {
        return res.status(400).json({ message: "Name and code are required" });
      }

      const [existing] = await pool.query(
        "SELECT id FROM warehouses WHERE name = ? OR code = ?",
        [name.trim(), code.trim()]
      );
      if (existing.length > 0) {
        return res.status(400).json({ message: "Warehouse name or code already exists" });
      }

      const [result] = await pool.query(
        "INSERT INTO warehouses (name, code, address, city, state, manager_name, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
        [name.trim(), code.trim(), address || null, city || null, state || null, manager_name || null, phone || null]
      );

      const [rows] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error("Create warehouse error:", error);
      res.status(500).json({ message: "Failed to create warehouse", error: error.message });
    }
  });

  // Create stock transfer
  router.post("/transfers", async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { from_warehouse_id, to_warehouse_id, note, items } = req.body;

      if (!from_warehouse_id || !to_warehouse_id) {
        return res.status(400).json({ message: "from_warehouse_id and to_warehouse_id are required" });
      }
      if (from_warehouse_id === to_warehouse_id) {
        return res.status(400).json({ message: "Source and destination warehouses must be different" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      const [fromWh] = await connection.query("SELECT * FROM warehouses WHERE id = ?", [from_warehouse_id]);
      const [toWh] = await connection.query("SELECT * FROM warehouses WHERE id = ?", [to_warehouse_id]);
      if (fromWh.length === 0 || toWh.length === 0) {
        return res.status(404).json({ message: "One or both warehouses not found" });
      }

      await connection.beginTransaction();

      const [maxRow] = await connection.query(
        "SELECT MAX(CAST(SUBSTRING(transfer_number, 4) AS UNSIGNED)) AS maxNum FROM stock_transfers WHERE transfer_number LIKE 'TRN-%'"
      );
      const nextNum = (maxRow[0].maxNum || 0) + 1;
      const transfer_number = "TRN-" + String(nextNum).padStart(6, "0");

      const [transferResult] = await connection.query(
        `INSERT INTO stock_transfers (transfer_number, from_warehouse_id, to_warehouse_id, status, requested_by, note)
         VALUES (?, ?, ?, 'requested', ?, ?)`,
        [transfer_number, from_warehouse_id, to_warehouse_id, req.user.id, note || null]
      );

      const transferId = transferResult.insertId;

      for (const item of items) {
        if (!item.product_id || !item.quantity || item.quantity <= 0) {
          await connection.rollback();
          return res.status(400).json({ message: "Each item must have a valid product_id and positive quantity" });
        }

        const [stockRows] = await connection.query(
          "SELECT quantity, reserved FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?",
          [from_warehouse_id, item.product_id]
        );

        if (stockRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({ message: `Product ${item.product_id} not found in source warehouse` });
        }

        const available = stockRows[0].quantity - stockRows[0].reserved;
        if (available < item.quantity) {
          await connection.rollback();
          return res.status(400).json({
            message: `Insufficient stock for product ${item.product_id} in source warehouse (available: ${available})`,
          });
        }

        await connection.query(
          "INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES (?, ?, ?)",
          [transferId, item.product_id, item.quantity]
        );
      }

      await connection.commit();

      const [rows] = await connection.query("SELECT * FROM stock_transfers WHERE id = ?", [transferId]);
      res.status(201).json(rows[0]);
    } catch (error) {
      await connection.rollback();
      console.error("Create transfer error:", error);
      res.status(500).json({ message: "Failed to create transfer", error: error.message });
    } finally {
      connection.release();
    }
  });

  // Update transfer status
  router.put("/transfers/:id/status", async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validTransitions = {
        requested: ["approved", "cancelled"],
        approved: ["dispatched", "cancelled"],
        dispatched: ["received"],
        received: ["completed"],
        completed: [],
        cancelled: [],
      };

      const [existing] = await connection.query("SELECT * FROM stock_transfers WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ message: "Transfer not found" });
      }

      const current = existing[0].status;
      if (!validTransitions[current] || !validTransitions[current].includes(status)) {
        return res.status(400).json({ message: `Invalid status transition from '${current}' to '${status}'` });
      }

      await connection.beginTransaction();

      if (status === "received") {
        const [items] = await connection.query(
          "SELECT product_id, quantity FROM stock_transfer_items WHERE transfer_id = ?",
          [id]
        );

        for (const item of items) {
          const [srcStock] = await connection.query(
            "SELECT quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ? FOR UPDATE",
            [existing[0].from_warehouse_id, item.product_id]
          );

          if (srcStock.length > 0 && srcStock[0].quantity >= item.quantity) {
            await connection.query(
              "UPDATE warehouse_inventory SET quantity = quantity - ? WHERE warehouse_id = ? AND product_id = ?",
              [item.quantity, existing[0].from_warehouse_id, item.product_id]
            );
          }
        }

        for (const item of items) {
          await connection.query(
            `INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity, reserved)
             VALUES (?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
            [existing[0].to_warehouse_id, item.product_id, item.quantity]
          );
        }
      }

      let updateSql = "UPDATE stock_transfers SET status = ?";
      const params = [status];
      if (status === "received") {
        updateSql += ", received_date = CURDATE()";
      }
      if (status === "approved") {
        updateSql += ", approved_by = ?";
        params.push(req.user.id);
      }
      updateSql += " WHERE id = ?";
      params.push(id);

      await connection.query(updateSql, params);

      await connection.commit();

      const [rows] = await connection.query("SELECT * FROM stock_transfers WHERE id = ?", [id]);
      res.json(rows[0]);
    } catch (error) {
      await connection.rollback();
      console.error("Update transfer status error:", error);
      res.status(500).json({ message: "Failed to update transfer status", error: error.message });
    } finally {
      connection.release();
    }
  });

  // Update warehouse
  router.put("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, address, city, state, manager_name, phone, status } = req.body;

      const [existing] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      if (name || code) {
        const [dup] = await pool.query(
          "SELECT id FROM warehouses WHERE (name = ? OR code = ?) AND id != ?",
          [name || existing[0].name, code || existing[0].code, id]
        );
        if (dup.length > 0) {
          return res.status(400).json({ message: "Warehouse name or code already exists" });
        }
      }

      await pool.query(
        `UPDATE warehouses SET
          name = COALESCE(?, name),
          code = COALESCE(?, code),
          address = COALESCE(?, address),
          city = COALESCE(?, city),
          state = COALESCE(?, state),
          manager_name = COALESCE(?, manager_name),
          phone = COALESCE(?, phone),
          status = COALESCE(?, status)
        WHERE id = ?`,
        [name, code, address, city, state, manager_name, phone, status, id]
      );

      const [rows] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [id]);
      res.json(rows[0]);
    } catch (error) {
      console.error("Update warehouse error:", error);
      res.status(500).json({ message: "Failed to update warehouse", error: error.message });
    }
  });

  // Set/update product quantity in warehouse
  router.post("/:id/inventory", async (req, res) => {
    try {
      const { id } = req.params;
      const { product_id, quantity, reserved } = req.body;

      if (!product_id || quantity === undefined || quantity === null) {
        return res.status(400).json({ message: "product_id and quantity are required" });
      }

      const [whRows] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [id]);
      if (whRows.length === 0) {
        return res.status(404).json({ message: "Warehouse not found" });
      }

      await pool.query(
        `INSERT INTO warehouse_inventory (warehouse_id, product_id, quantity, reserved)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), reserved = VALUES(reserved)`,
        [id, product_id, quantity, reserved || 0]
      );

      const [rows] = await pool.query(
        "SELECT * FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?",
        [id, product_id]
      );
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error("Update inventory error:", error);
      res.status(500).json({ message: "Failed to update inventory", error: error.message });
    }
  });

  // Soft delete warehouse
  router.delete("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [existing] = await pool.query("SELECT * FROM warehouses WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ message: "Warehouse not found" });
      }
      await pool.query("UPDATE warehouses SET status = 'inactive' WHERE id = ?", [id]);
      res.json({ message: "Warehouse deactivated successfully" });
    } catch (error) {
      console.error("Delete warehouse error:", error);
      res.status(500).json({ message: "Failed to deactivate warehouse", error: error.message });
    }
  });

  app.use("/api/warehouses", authRequired, adminOnly, router);
}
