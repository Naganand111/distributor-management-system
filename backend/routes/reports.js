import PDFDocument from "pdfkit";
import { Parser } from "json2csv";

const ORDERS_QUERY = `
  SELECT o.id,
         COALESCE(NULLIF(o.customer_name, ''), u.name, 'Unknown') AS customer_name,
         o.total_amount,
         o.status,
         o.payment_status,
         o.created_at
  FROM orders o
  LEFT JOIN users u ON o.user_id = u.id
  ORDER BY o.created_at DESC
`;

function triggerDownload(res, filename, contentType) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
}

export default function registerReportRoutes(app, pool, authRequired, adminOnly) {
  const guard = [authRequired, adminOnly];

  app.get("/api/reports/summary", ...guard, async (_, res) => {
    try {
      const [orders] = await pool.query(ORDERS_QUERY);

      const totalRevenue = orders
        .filter((o) => o.payment_status === "paid")
        .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

      const pendingPayments = orders.filter(
        (o) => o.payment_status === "pending"
      ).length;

      const monthMap = {};
      orders.forEach((o) => {
        if (o.payment_status !== "paid") return;
        const month = new Date(o.created_at).toLocaleString("default", {
          month: "short",
        });
        monthMap[month] = (monthMap[month] || 0) + Number(o.total_amount || 0);
      });

      const monthlyData = Object.keys(monthMap).map((month) => ({
        month,
        revenue: monthMap[month],
      }));

      const [topProducts] = await pool.query(`
        SELECT p.name, SUM(oi.quantity) AS quantity
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        GROUP BY p.id, p.name
        ORDER BY quantity DESC
        LIMIT 5
      `);

      res.json({
        success: true,
        stats: {
          totalRevenue,
          totalOrders: orders.length,
          pendingPayments,
        },
        monthlyData,
        topProducts,
      });
    } catch (err) {
      console.error("REPORTS SUMMARY ERROR:", err);
      res.status(500).json({ success: false, message: "Failed to load reports" });
    }
  });

  app.get("/api/reports/orders/pdf", ...guard, async (_, res) => {
    try {
      const [orders] = await pool.query(ORDERS_QUERY);

      if (!orders.length) {
        return res
          .status(404)
          .json({ success: false, message: "No orders found" });
      }

      triggerDownload(res, "orders-report.pdf", "application/pdf");

      const doc = new PDFDocument({ margin: 30 });
      doc.pipe(res);

      doc.fontSize(18).text("Orders Report", { align: "center" });
      doc.moveDown();
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, {
        align: "center",
      });
      doc.moveDown();

      doc.fontSize(12).text("ID | Customer | Amount | Status | Payment | Date", {
        underline: true,
      });
      doc.moveDown(0.5);

      orders.forEach((order) => {
        doc.fontSize(11).text(
          `${order.id} | ${order.customer_name} | ₹${order.total_amount} | ${order.status} | ${order.payment_status} | ${new Date(order.created_at).toLocaleString()}`
        );
      });

      doc.end();
    } catch (err) {
      console.error("ORDERS PDF ERROR:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Failed to generate PDF" });
      }
    }
  });

  app.get("/api/reports/orders/csv", ...guard, async (_, res) => {
    try {
      const [orders] = await pool.query(ORDERS_QUERY);

      if (!orders.length) {
        return res
          .status(404)
          .json({ success: false, message: "No orders found" });
      }

      const parser = new Parser({
        fields: [
          "id",
          "customer_name",
          "total_amount",
          "status",
          "payment_status",
          "created_at",
        ],
      });
      const csv = parser.parse(orders);

      triggerDownload(res, "orders-report.csv", "text/csv");
      res.status(200).send(csv);
    } catch (err) {
      console.error("ORDERS CSV ERROR:", err);
      res.status(500).json({ success: false, message: "Failed to generate CSV" });
    }
  });

  app.get("/api/reports/products/csv", ...guard, async (_, res) => {
    try {
      const [products] = await pool.query(`
        SELECT id, name, price, stock, description
        FROM products
        WHERE is_deleted = 0
        ORDER BY id DESC
      `);

      if (!products.length) {
        return res
          .status(404)
          .json({ success: false, message: "No products found" });
      }

      const parser = new Parser({
        fields: ["id", "name", "price", "stock", "description"],
      });
      const csv = parser.parse(products);

      triggerDownload(res, "products-report.csv", "text/csv");
      res.status(200).send(csv);
    } catch (err) {
      console.error("PRODUCTS CSV ERROR:", err);
      res.status(500).json({ success: false, message: "Failed to generate CSV" });
    }
  });
}
