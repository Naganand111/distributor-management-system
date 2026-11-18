import express from "express";
import writeExcelFile from "write-excel-file/node";
import { effectiveThresholdSql, isLowStockSql } from "../utils/inventoryThreshold.js";

const LEGACY_DATE_FORMAT = "m/d/yy";
const EXCEL_SERIAL_EPOCH_OFFSET = 25569;

// SheetJS treated Date values as local wall-clock time. write-excel-file uses
// the Date's UTC instant, so rebase the value to keep the old serial exactly.
function toLegacyExcelDate(value) {
  if (value === null || value === undefined) return { value: null };

  const base = new Date(1899, 11, 30, 0, 0, 0);
  const threshold =
    base.getTime() + (value.getTimezoneOffset() - base.getTimezoneOffset()) * 60000;
  const serial = (value.getTime() - threshold) / 86400000;
  return {
    value: new Date((serial - EXCEL_SERIAL_EPOCH_OFFSET) * 86400000),
    type: Date,
    format: LEGACY_DATE_FORMAT,
  };
}

function toLegacyCell(value) {
  if (value === null || value === undefined) return { value: null };
  // write-excel-file otherwise skips empty strings entirely. The text format
  // keeps an empty cell so the logical value remains an empty string.
  if (value === "") return { value: "", type: String, format: "@" };
  return { value };
}

function column(header, key, cell = toLegacyCell) {
  return { header, cell: (row) => cell(row[key]) };
}

const EXPORT_COLUMNS = {
  sales: [
    column("id", "id"),
    column("created_at", "created_at", toLegacyExcelDate),
    column("total_amount", "total_amount"),
    column("status", "status"),
    column("payment_status", "payment_status"),
    column("customer_name", "customer_name"),
  ],
  inventory: [
    column("id", "id"),
    column("name", "name"),
    column("sku", "sku"),
    column("stock", "stock"),
    column("purchase_price", "purchase_price"),
    column("mrp", "mrp"),
    column("price", "price"),
  ],
  purchases: [
    column("id", "id"),
    column("created_at", "created_at", toLegacyExcelDate),
    column("total_amount", "total_amount"),
    column("status", "status"),
    column("supplier_name", "supplier_name"),
  ],
  customers: [
    column("id", "id"),
    column("name", "name"),
    column("email", "email"),
    column("phone", "phone"),
    column("created_at", "created_at", toLegacyExcelDate),
  ],
  products: [
    column("id", "id"),
    column("name", "name"),
    column("sku", "sku"),
    column("price", "price"),
    column("mrp", "mrp"),
    column("stock", "stock"),
    column("status", "status"),
  ],
};

export default function registerAdvancedReportRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  // ── SALES REPORTS ──

  router.get("/sales/daily", async (req, res) => {
    try {
      const { from, to } = req.query;
      const toDate = to || new Date().toISOString().slice(0, 10);
      const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

      const [rows] = await pool.query(
        `SELECT DATE(created_at) AS date,
                SUM(total_amount) AS revenue,
                COUNT(*) AS orders,
                ROUND(AVG(total_amount), 2) AS avg_order_value
         FROM orders
         WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'cancelled'
         GROUP BY DATE(created_at)
         ORDER BY date`,
        [fromDate, toDate]
      );
      res.json(rows);
    } catch (err) {
      console.error("Daily sales error:", err);
      res.status(500).json({ error: "Failed to get daily sales" });
    }
  });

  router.get("/sales/weekly", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT YEARWEEK(created_at, 1) AS year_week,
                MIN(DATE(created_at)) AS week_start,
                SUM(total_amount) AS revenue,
                COUNT(*) AS orders
         FROM orders
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH) AND status != 'cancelled'
         GROUP BY year_week
         ORDER BY year_week DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("Weekly sales error:", err);
      res.status(500).json({ error: "Failed to get weekly sales" });
    }
  });

  router.get("/sales/monthly", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
                SUM(total_amount) AS revenue,
                COUNT(*) AS orders
         FROM orders
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) AND status != 'cancelled'
         GROUP BY month
         ORDER BY month DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("Monthly sales error:", err);
      res.status(500).json({ error: "Failed to get monthly sales" });
    }
  });

  router.get("/sales/by-product", async (req, res) => {
    try {
      const { from, to, product_id } = req.query;
      let where = ["o.status != 'cancelled'"];
      const params = [];
      if (from) { where.push("o.created_at >= ?"); params.push(from); }
      if (to) { where.push("o.created_at <= ?"); params.push(to); }
      if (product_id) { where.push("oi.product_id = ?"); params.push(product_id); }

      const [rows] = await pool.query(
        `SELECT oi.product_id, p.name AS product_name, p.sku,
                SUM(oi.quantity) AS total_sold,
                SUM(oi.quantity * oi.price) AS total_revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE ${where.join(" AND ")}
         GROUP BY oi.product_id, p.name, p.sku
         ORDER BY total_revenue DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error("Sales by product error:", err);
      res.status(500).json({ error: "Failed to get sales by product" });
    }
  });

  router.get("/sales/by-customer", async (req, res) => {
    try {
      const { from, to } = req.query;
      let where = ["o.status != 'cancelled'"];
      const params = [];
      if (from) { where.push("o.created_at >= ?"); params.push(from); }
      if (to) { where.push("o.created_at <= ?"); params.push(to); }

      const [rows] = await pool.query(
        `SELECT o.user_id, u.name AS customer_name,
                COUNT(*) AS order_count,
                SUM(o.total_amount) AS total_revenue
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         WHERE ${where.join(" AND ")}
         GROUP BY o.user_id, u.name
         ORDER BY total_revenue DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error("Sales by customer error:", err);
      res.status(500).json({ error: "Failed to get sales by customer" });
    }
  });

  router.get("/sales/by-sales-rep", async (req, res) => {
    try {
      const { from, to } = req.query;
      let where = ["o.status != 'cancelled'"];
      const params = [];
      if (from) { where.push("o.created_at >= ?"); params.push(from); }
      if (to) { where.push("o.created_at <= ?"); params.push(to); }

      const [rows] = await pool.query(
        `SELECT o.salesman AS sales_rep_id, rep.name AS sales_rep_name,
                COUNT(*) AS order_count,
                SUM(o.total_amount) AS total_revenue
         FROM orders o
         LEFT JOIN sales_representatives rep ON rep.id = o.salesman
         WHERE ${where.join(" AND ")}
         GROUP BY o.salesman, rep.name
         ORDER BY total_revenue DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error("Sales by sales rep error:", err);
      res.status(500).json({ error: "Failed to get sales by rep" });
    }
  });

  router.get("/sales/by-territory", async (req, res) => {
    try {
      const { from, to } = req.query;
      let where = ["o.status != 'cancelled'"];
      const params = [];
      if (from) { where.push("o.created_at >= ?"); params.push(from); }
      if (to) { where.push("o.created_at <= ?"); params.push(to); }

      const [rows] = await pool.query(
        `SELECT t.id AS territory_id, t.name AS territory_name,
                COUNT(*) AS order_count,
                SUM(o.total_amount) AS total_revenue
         FROM orders o
         LEFT JOIN retailers r ON r.id = o.retailer_id
         LEFT JOIN territories t ON t.id = r.territory_id
         WHERE ${where.join(" AND ")}
         GROUP BY t.id, t.name
         ORDER BY total_revenue DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error("Sales by territory error:", err);
      res.status(500).json({ error: "Failed to get sales by territory" });
    }
  });

  router.get("/sales/status-report", async (req, res) => {
    try {
      const { from, to } = req.query;
      let where = ["1=1"];
      const params = [];
      if (from) { where.push("created_at >= ?"); params.push(from); }
      if (to) { where.push("created_at <= ?"); params.push(to); }

      const [rows] = await pool.query(
        `SELECT status, COUNT(*) AS count, SUM(total_amount) AS total_value
         FROM orders
         WHERE ${where.join(" AND ")}
         GROUP BY status
         ORDER BY count DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error("Status report error:", err);
      res.status(500).json({ error: "Failed to get status report" });
    }
  });

  // ── INVENTORY REPORTS ──

  router.get("/inventory/current", async (req, res) => {
    try {
      const [rows] = await pool.query(
`SELECT p.id, p.name, p.sku, p.stock, p.purchase_price,
ROUND(p.stock * p.purchase_price, 2) AS stock_value,
p.min_stock_level,
p.reorder_level,
${effectiveThresholdSql("p")} AS effective_reorder_level,
${isLowStockSql("p")} AS is_low_stock
FROM products p
WHERE p.status = 'active'
ORDER BY p.stock ASC`
      );
      res.json(rows);
    } catch (err) {
      console.error("Current inventory error:", err);
      res.status(500).json({ error: "Failed to get inventory" });
    }
  });

  router.get("/inventory/movement", async (req, res) => {
    try {
      const { from, to } = req.query;
      let where = ["1=1"];
      const params = [];
      if (from) { where.push("im.created_at >= ?"); params.push(from); }
      if (to) { where.push("im.created_at <= ?"); params.push(to); }

      const [rows] = await pool.query(
        `SELECT im.*, p.name AS product_name
         FROM inventory_movements im
         LEFT JOIN products p ON p.id = im.product_id
         WHERE ${where.join(" AND ")}
         ORDER BY im.created_at DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error("Inventory movement error:", err);
      res.status(500).json({ error: "Failed to get movements" });
    }
  });

  router.get("/inventory/dead-stock", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT p.id, p.name, p.sku, p.stock, p.purchase_price,
                ROUND(p.stock * p.purchase_price, 2) AS stock_value
         FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
         LEFT JOIN orders o ON o.id = oi.order_id AND o.status != 'cancelled' AND o.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         WHERE p.status = 'active' AND p.stock > 0 AND o.id IS NULL
         ORDER BY stock_value DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("Dead stock error:", err);
      res.status(500).json({ error: "Failed to get dead stock" });
    }
  });

  router.get("/inventory/valuation", async (req, res) => {
    try {
      const [warehouseData] = await pool.query(
        `SELECT w.id, w.name AS warehouse_name,
                SUM(wi.quantity) AS total_quantity,
                ROUND(SUM(wi.quantity * p.purchase_price), 2) AS total_value
         FROM warehouse_inventory wi
         JOIN warehouses w ON w.id = wi.warehouse_id
         JOIN products p ON p.id = wi.product_id
         GROUP BY w.id, w.name`
      );

      if (warehouseData.length > 0) {
        return res.json({ level: "warehouse", data: warehouseData });
      }

      const [productData] = await pool.query(
        `SELECT SUM(stock) AS total_quantity,
                ROUND(SUM(stock * purchase_price), 2) AS total_value
         FROM products WHERE status = 'active'`
      );
      res.json({ level: "product", data: productData[0] });
    } catch (err) {
      console.error("Valuation error:", err);
      res.status(500).json({ error: "Failed to get valuation" });
    }
  });

  // ── PURCHASE REPORTS ──

  router.get("/purchases/summary", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS total_pos,
                SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS received,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                COALESCE(SUM(total_amount), 0) AS total_value
         FROM purchase_orders`
      );
      res.json(rows[0]);
    } catch (err) {
      console.error("Purchase summary error:", err);
      res.status(500).json({ error: "Failed to get purchase summary" });
    }
  });

  router.get("/purchases/by-supplier", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT s.id AS supplier_id, s.company_name AS supplier_name,
                COUNT(po.id) AS po_count,
                COALESCE(SUM(po.total_amount), 0) AS total_value
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         GROUP BY s.id, s.company_name
         ORDER BY total_value DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("Purchases by supplier error:", err);
      res.status(500).json({ error: "Failed to get purchases by supplier" });
    }
  });

  // ── FINANCIAL REPORTS ──

  router.get("/financial/summary", async (req, res) => {
    try {
      const [revenue] = await pool.query(
        "SELECT COALESCE(SUM(total_amount), 0) AS revenue FROM orders WHERE status = 'delivered'"
      );
      const [purchaseCost] = await pool.query(
        "SELECT COALESCE(SUM(total_amount), 0) AS cost FROM purchase_orders WHERE status = 'received'"
      );
      const [payments] = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) AS collected FROM payments"
      );
      const [outstanding] = await pool.query(
        "SELECT COALESCE(SUM(total_amount), 0) AS outstanding FROM orders WHERE status IN ('pending','processing') AND payment_status != 'paid'"
      );

      const rev = revenue[0].revenue;
      const cost = purchaseCost[0].cost;
      const profit = rev - cost;
      const margin = rev > 0 ? ((profit / rev) * 100).toFixed(2) : 0;

      res.json({
        revenue: rev,
        purchase_cost: cost,
        gross_profit: profit,
        margin_percent: Number(margin),
        payments_collected: payments[0].collected,
        outstanding: outstanding[0].outstanding,
      });
    } catch (err) {
      console.error("Financial summary error:", err);
      res.status(500).json({ error: "Failed to get financial summary" });
    }
  });

  router.get("/financial/expenses", async (req, res) => {
    try {
      const { from, to } = req.query;
      let where = ["1=1"];
      const params = [];
      if (from) { where.push("created_at >= ?"); params.push(from); }
      if (to) { where.push("created_at <= ?"); params.push(to); }

      const [rows] = await pool.query(
        `SELECT e.*, u.name AS created_by_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE ${where.join(" AND ")}
         ORDER BY e.created_at DESC`,
        params
      );
      const [total] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE ${where.join(" AND ")}`,
        params
      );
      res.json({ expenses: rows, total: total[0].total });
    } catch (err) {
      console.error("Expenses error:", err);
      res.status(500).json({ error: "Failed to get expenses" });
    }
  });

  router.post("/financial/expenses", async (req, res) => {
    try {
      const { description, amount, category, notes } = req.body;
      if (!description || !amount) return res.status(400).json({ error: "description and amount required" });

      const [result] = await pool.query(
        "INSERT INTO expenses (description, amount, category, expense_date, created_by) VALUES (?, ?, ?, NOW(), ?)",
        [description, amount, category || null, req.user?.id || null]
      );
      res.status(201).json({ id: result.insertId, message: "Expense added" });
    } catch (err) {
      console.error("Add expense error:", err);
      res.status(500).json({ error: "Failed to add expense" });
    }
  });

  // ── EXPORT ──

  router.get("/export/:type", async (req, res) => {
    try {
      const { type } = req.params;
      const { from, to } = req.query;
      let data = [];

      const dateFilter = from && to ? "WHERE created_at BETWEEN ? AND ?" : "";
      const dateParams = from && to ? [from, to] : [];

      switch (type) {
        case "sales":
          [data] = await pool.query(
            `SELECT o.id, o.created_at, o.total_amount, o.status, o.payment_status,
                    u.name AS customer_name
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             ${dateFilter}
             ORDER BY o.created_at DESC`,
            dateParams
          );
          break;
        case "inventory":
          [data] = await pool.query(
            `SELECT p.id, p.name, p.sku, p.stock, p.purchase_price, p.mrp, p.price
             FROM products p
             ORDER BY p.name`
          );
          break;
        case "purchases":
          [data] = await pool.query(
            `SELECT po.id, po.created_at, po.total_amount, po.status, s.company_name AS supplier_name
             FROM purchase_orders po
             LEFT JOIN suppliers s ON s.id = po.supplier_id
             ${dateFilter}
             ORDER BY po.created_at DESC`,
            dateParams
          );
          break;
        case "customers":
          [data] = await pool.query(
            "SELECT id, name, email, COALESCE(mobile, '') AS phone, created_at FROM users ORDER BY name"
          );
          break;
        case "products":
          [data] = await pool.query(
            "SELECT id, name, sku, price, mrp, stock, status FROM products ORDER BY name"
          );
          break;
        default:
          return res.status(400).json({ error: "Invalid export type" });
      }

      // The previous implementation produced no header row for empty results.
      // Omitting `columns` preserves that behavior because write-excel-file
      // only adds a header row when at least one column defines one.
      const buf =
        data.length === 0
          ? await writeExcelFile([], { sheet: "Sheet1" }).toBuffer()
          : await writeExcelFile(data, {
              sheet: "Sheet1",
              columns: EXPORT_COLUMNS[type],
            }).toBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=${type}_report.xlsx`);
      res.send(buf);
    } catch (err) {
      console.error("Export error:", err);
      res.status(500).json({ error: "Failed to export" });
    }
  });

  app.use("/api/reports/advanced", authRequired, adminOnly, router);
}
