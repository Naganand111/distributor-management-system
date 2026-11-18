import express from "express";

export default function registerLoyaltyRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  // Customer-facing: get my loyalty account
  app.get("/api/loyalty/mine", authRequired, async (req, res) => {
    try {
      const userId = req.user.id;
      let [rows] = await pool.query("SELECT * FROM loyalty_accounts WHERE user_id = ?", [userId]);
      if (rows.length === 0) {
        await pool.query(
          "INSERT INTO loyalty_accounts (user_id, points_balance, total_earned, total_redeemed) VALUES (?, 0, 0, 0)",
          [userId]
        );
        [rows] = await pool.query("SELECT * FROM loyalty_accounts WHERE user_id = ?", [userId]);
      }
      res.json(rows[0]);
    } catch (error) {
      console.error("Get my loyalty account error:", error);
      res.status(500).json({ message: "Failed to fetch loyalty account", error: error.message });
    }
  });

  // Customer-facing: get my transactions
  app.get("/api/loyalty/transactions/mine", authRequired, async (req, res) => {
    try {
      const userId = req.user.id;
      const [rows] = await pool.query(
        "SELECT * FROM loyalty_transactions WHERE user_id = ? ORDER BY created_at DESC",
        [userId]
      );
      res.json(rows);
    } catch (error) {
      console.error("Get my loyalty transactions error:", error);
      res.status(500).json({ message: "Failed to fetch transactions", error: error.message });
    }
  });

  // Get config
  router.get("/config", async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT * FROM loyalty_config WHERE id = 1");
      if (rows.length === 0) {
        return res.status(404).json({ message: "Loyalty config not found" });
      }
      res.json(rows[0]);
    } catch (error) {
      console.error("Get loyalty config error:", error);
      res.status(500).json({ message: "Failed to fetch config", error: error.message });
    }
  });

  // Update config
  router.put("/config", async (req, res) => {
    try {
      const { points_per_100_rupees, redemption_min_points, points_to_rupee, expiry_days, status } = req.body;

      const [existing] = await pool.query("SELECT * FROM loyalty_config WHERE id = 1");
      if (existing.length === 0) {
        return res.status(404).json({ message: "Loyalty config not found" });
      }

      await pool.query(
        `UPDATE loyalty_config SET
          points_per_100_rupees = COALESCE(?, points_per_100_rupees),
          redemption_min_points = COALESCE(?, redemption_min_points),
          points_to_rupee = COALESCE(?, points_to_rupee),
          expiry_days = COALESCE(?, expiry_days),
          status = COALESCE(?, status)
        WHERE id = 1`,
        [points_per_100_rupees, redemption_min_points, points_to_rupee, expiry_days, status]
      );

      const [rows] = await pool.query("SELECT * FROM loyalty_config WHERE id = 1");
      res.json(rows[0]);
    } catch (error) {
      console.error("Update loyalty config error:", error);
      res.status(500).json({ message: "Failed to update config", error: error.message });
    }
  });

  // List all accounts
  router.get("/accounts", async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT la.*, u.name AS user_name, u.email AS user_email
        FROM loyalty_accounts la
        JOIN users u ON la.user_id = u.id
        ORDER BY la.points_balance DESC
      `);
      res.json(rows);
    } catch (error) {
      console.error("List loyalty accounts error:", error);
      res.status(500).json({ message: "Failed to fetch accounts", error: error.message });
    }
  });

  // Get account for specific user
  router.get("/account/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const [rows] = await pool.query(`
        SELECT la.*, u.name AS user_name, u.email AS user_email
        FROM loyalty_accounts la
        JOIN users u ON la.user_id = u.id
        WHERE la.user_id = ?
      `, [userId]);
      if (rows.length === 0) {
        return res.status(404).json({ message: "Loyalty account not found for this user" });
      }
      res.json(rows[0]);
    } catch (error) {
      console.error("Get loyalty account error:", error);
      res.status(500).json({ message: "Failed to fetch account", error: error.message });
    }
  });

  // Earn points for an order
  router.post("/earn", async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { userId, orderId, amount } = req.body;
      if (!userId || !orderId || amount === undefined || amount === null) {
        return res.status(400).json({ message: "userId, orderId, and amount are required" });
      }
      if (amount <= 0) {
        return res.status(400).json({ message: "Amount must be positive" });
      }

      await connection.beginTransaction();

      const [configRows] = await connection.query("SELECT * FROM loyalty_config WHERE id = 1");
      if (configRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Loyalty config not found" });
      }
      const config = configRows[0];

      if (config.status !== "active") {
        await connection.rollback();
        return res.status(400).json({ message: "Loyalty program is not active" });
      }

      const points = Math.floor(amount / 100) * config.points_per_100_rupees;
      if (points <= 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Amount too low to earn any points" });
      }

      const [existing] = await connection.query("SELECT * FROM loyalty_accounts WHERE user_id = ?", [userId]);
      let newBalance;

      if (existing.length === 0) {
        newBalance = points;
        await connection.query(
          "INSERT INTO loyalty_accounts (user_id, points_balance, total_earned, total_redeemed) VALUES (?, ?, ?, 0)",
          [userId, points, points]
        );
      } else {
        newBalance = existing[0].points_balance + points;
        const newTotalEarned = existing[0].total_earned + points;
        await connection.query(
          "UPDATE loyalty_accounts SET points_balance = ?, total_earned = ? WHERE user_id = ?",
          [newBalance, newTotalEarned, userId]
        );
      }

      await connection.query(
        `INSERT INTO loyalty_transactions (user_id, type, points, balance_after, reference_type, reference_id, note, created_by)
         VALUES (?, 'earn', ?, ?, 'order', ?, ?, ?)`,
        [userId, points, newBalance, orderId, `Earned ${points} points for order #${orderId}`, req.user.id]
      );

      await connection.commit();

      res.status(201).json({ message: `${points} points earned`, points_earned: points, new_balance: newBalance });
    } catch (error) {
      await connection.rollback();
      console.error("Earn points error:", error);
      res.status(500).json({ message: "Failed to earn points", error: error.message });
    } finally {
      connection.release();
    }
  });

  // Redeem points
  router.post("/redeem", async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { userId, points, note } = req.body;
      if (!userId || !points) {
        return res.status(400).json({ message: "userId and points are required" });
      }
      if (points <= 0) {
        return res.status(400).json({ message: "Points must be positive" });
      }

      await connection.beginTransaction();

      const [configRows] = await connection.query("SELECT * FROM loyalty_config WHERE id = 1");
      if (configRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Loyalty config not found" });
      }
      const config = configRows[0];

      const [accountRows] = await connection.query("SELECT * FROM loyalty_accounts WHERE user_id = ?", [userId]);
      if (accountRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Loyalty account not found" });
      }

      const account = accountRows[0];
      if (account.points_balance < points) {
        await connection.rollback();
        return res.status(400).json({ message: "Insufficient points balance" });
      }
      if (points < config.redemption_min_points) {
        await connection.rollback();
        return res.status(400).json({ message: `Minimum redemption is ${config.redemption_min_points} points` });
      }

      const newBalance = account.points_balance - points;
      const newTotalRedeemed = account.total_redeemed + points;
      await connection.query(
        "UPDATE loyalty_accounts SET points_balance = ?, total_redeemed = ? WHERE user_id = ?",
        [newBalance, newTotalRedeemed, userId]
      );

      await connection.query(
        `INSERT INTO loyalty_transactions (user_id, type, points, balance_after, reference_type, note, created_by)
         VALUES (?, 'redeem', ?, ?, 'manual', ?, ?)`,
        [userId, points, newBalance, note || `Redeemed ${points} points`, req.user.id]
      );

      await connection.commit();

      res.status(201).json({ message: `${points} points redeemed`, points_redeemed: points, new_balance: newBalance });
    } catch (error) {
      await connection.rollback();
      console.error("Redeem points error:", error);
      res.status(500).json({ message: "Failed to redeem points", error: error.message });
    } finally {
      connection.release();
    }
  });

  // Admin adjust points
  router.post("/adjust", async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { userId, points, note } = req.body;
      if (!userId || points === undefined || points === null) {
        return res.status(400).json({ message: "userId and points are required" });
      }
      if (!note) {
        return res.status(400).json({ message: "note is required for manual adjustments" });
      }

      await connection.beginTransaction();

      const [accountRows] = await connection.query("SELECT * FROM loyalty_accounts WHERE user_id = ?", [userId]);
      if (accountRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Loyalty account not found" });
      }

      const account = accountRows[0];
      const newBalance = account.points_balance + points;
      if (newBalance < 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Adjustment would result in negative balance" });
      }

      if (points > 0) {
        await connection.query(
          "UPDATE loyalty_accounts SET points_balance = ?, total_earned = total_earned + ? WHERE user_id = ?",
          [newBalance, points, userId]
        );
      } else {
        await connection.query(
          "UPDATE loyalty_accounts SET points_balance = ?, total_redeemed = total_redeemed + ? WHERE user_id = ?",
          [newBalance, Math.abs(points), userId]
        );
      }

      await connection.query(
        `INSERT INTO loyalty_transactions (user_id, type, points, balance_after, reference_type, note, created_by)
         VALUES (?, 'adjust', ?, ?, 'manual', ?, ?)`,
        [userId, points, newBalance, note, req.user.id]
      );

      await connection.commit();

      res.status(201).json({ message: `Adjusted ${points} points`, new_balance: newBalance });
    } catch (error) {
      await connection.rollback();
      console.error("Adjust points error:", error);
      res.status(500).json({ message: "Failed to adjust points", error: error.message });
    } finally {
      connection.release();
    }
  });

  // List all transactions
  router.get("/transactions", async (req, res) => {
    try {
      const { userId } = req.query;
      let sql = `
        SELECT lt.*, u.name AS user_name, u.email AS user_email
        FROM loyalty_transactions lt
        JOIN users u ON lt.user_id = u.id
      `;
      const params = [];

      if (userId) {
        sql += " WHERE lt.user_id = ?";
        params.push(userId);
      }
      sql += " ORDER BY lt.created_at DESC";

      const [rows] = await pool.query(sql, params);
      res.json(rows);
    } catch (error) {
      console.error("List loyalty transactions error:", error);
      res.status(500).json({ message: "Failed to fetch transactions", error: error.message });
    }
  });

  // Dashboard
  router.get("/dashboard", async (req, res) => {
    try {
      const [totalAccounts] = await pool.query("SELECT COUNT(*) AS total FROM loyalty_accounts");
      const [totalEarned] = await pool.query("SELECT COALESCE(SUM(total_earned), 0) AS total FROM loyalty_accounts");
      const [totalRedeemed] = await pool.query("SELECT COALESCE(SUM(total_redeemed), 0) AS total FROM loyalty_accounts");
      const [activeMembers] = await pool.query("SELECT COUNT(*) AS total FROM loyalty_accounts WHERE points_balance > 0");
      const [recentActive] = await pool.query(`
        SELECT la.*, u.name AS user_name
        FROM loyalty_accounts la
        JOIN users u ON la.user_id = u.id
        WHERE la.points_balance > 0
        ORDER BY la.points_balance DESC
        LIMIT 10
      `);

      res.json({
        total_accounts: totalAccounts[0].total,
        total_points_earned: totalEarned[0].total,
        total_points_redeemed: totalRedeemed[0].total,
        active_members: activeMembers[0].total,
        recently_active: recentActive,
      });
    } catch (error) {
      console.error("Loyalty dashboard error:", error);
      res.status(500).json({ message: "Failed to fetch dashboard", error: error.message });
    }
  });

  // Customer-facing: redeem points against their own unpaid order (registered before admin-only router)
  app.post("/api/loyalty/redeem/mine", authRequired, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const userId = req.user.id;
      const { points, order_id } = req.body;
      if (!points || points <= 0) {
        return res.status(400).json({ message: "Points must be positive" });
      }
      if (!order_id) {
        return res.status(400).json({ message: "order_id is required" });
      }

      const [orderRows] = await connection.query(
        "SELECT id, user_id, total_amount, discount, paid_amount, payment_status, status FROM orders WHERE id = ?",
        [order_id]
      );
      if (orderRows.length === 0 || orderRows[0].user_id !== userId) {
        return res.status(404).json({ message: "Order not found" });
      }
      const order = orderRows[0];
      if (order.payment_status === "paid") {
        return res.status(400).json({ message: "Order is already paid" });
      }
      if (order.status === "cancelled") {
        return res.status(400).json({ message: "Order is cancelled" });
      }

      await connection.beginTransaction();

      const [configRows] = await connection.query("SELECT * FROM loyalty_config WHERE id = 1");
      if (configRows.length === 0 || configRows[0].status !== "active") {
        await connection.rollback();
        return res.status(400).json({ message: "Loyalty program is not active" });
      }
      const config = configRows[0];
      if (points < Number(config.redemption_min_points)) {
        await connection.rollback();
        return res.status(400).json({ message: `Minimum redemption is ${config.redemption_min_points} points` });
      }

      const [accountRows] = await connection.query("SELECT * FROM loyalty_accounts WHERE user_id = ?", [userId]);
      if (accountRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Loyalty account not found" });
      }
      const account = accountRows[0];
      if (Number(account.points_balance) < points) {
        await connection.rollback();
        return res.status(400).json({ message: "Insufficient points balance" });
      }

      const rupeeValue = Math.floor(points * Number(config.points_to_rupee || 1));
      const totalDue = Number(order.total_amount || 0) - Number(order.discount || 0);
      if (rupeeValue <= 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Redemption value is zero" });
      }
      const appliedDiscount = Math.min(rupeeValue, totalDue);
      const newOrderDiscount = Number(order.discount || 0) + appliedDiscount;
      const newBalance = Number(account.points_balance) - points;

      await connection.query(
        "UPDATE orders SET discount = ? WHERE id = ?",
        [newOrderDiscount, order_id]
      );
      await connection.query(
        "UPDATE invoices SET discount = ?, taxable_amount = GREATEST(taxable_amount - ?, 0), grand_total = GREATEST(grand_total - ?, 0) WHERE order_id = ?",
        [newOrderDiscount, appliedDiscount, appliedDiscount, order_id]
      );
      await connection.query(
        "UPDATE loyalty_accounts SET points_balance = ?, total_redeemed = total_redeemed + ? WHERE user_id = ?",
        [newBalance, points, userId]
      );
      await connection.query(
        `INSERT INTO loyalty_transactions (user_id, type, points, balance_after, reference_type, reference_id, note, created_by)
         VALUES (?, 'redeem', ?, ?, 'order', ?, 'Points redeemed against order #?', ?)`,
        [userId, points, newBalance, order_id, order_id, userId]
      );

      await connection.commit();
      res.status(201).json({
        message: `${points} points redeemed (₹${appliedDiscount} off order #${order_id})`,
        points_redeemed: points,
        discount_applied: appliedDiscount,
        new_balance: newBalance,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Customer redeem points error:", error);
      res.status(500).json({ message: "Failed to redeem points", error: error.message });
    } finally {
      connection.release();
    }
  });

  app.use("/api/loyalty", authRequired, adminOnly, router);
}
