import express from "express";
import { effectiveThresholdSql, isLowStockSql } from "../utils/inventoryThreshold.js";
import { amountsFromOrder } from "../utils/orderTotals.js";

export default function registerDmsRoutes(
  app,
  pool,
  authRequired,
  adminOnly
) {
  const router = express.Router();

  /* =====================================================
     CATEGORIES
  ===================================================== */

  router.get("/categories", authRequired, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM categories ORDER BY name ASC"
      );

      res.json(rows);
    } catch (err) {
      console.error("GET CATEGORIES ERROR:", err);
      res.status(500).json({
        error: "Failed to fetch categories",
      });
    }
  });

  router.post("/categories", authRequired, adminOnly, async (req, res) => {
    try {
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Category name is required",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO categories (name, description)
         VALUES (?, ?)`,
        [name, description || null]
      );

      res.status(201).json({
        success: true,
        id: result.insertId,
      });
    } catch (err) {
      console.error("CREATE CATEGORY ERROR:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({
          error: "Category already exists",
        });
      }

      res.status(500).json({
        error: "Failed to create category",
      });
    }
  });

  router.put("/categories/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const { name, description, status } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Category name is required",
        });
      }

      await pool.query(
        `UPDATE categories
         SET name=?, description=?, status=?
         WHERE id=?`,
        [
          name,
          description || null,
          status || "active",
          req.params.id,
        ]
      );

      res.json({
        success: true,
      });
    } catch (err) {
      console.error("UPDATE CATEGORY ERROR:", err);

      res.status(500).json({
        error: "Failed to update category",
      });
    }
  });

  router.delete(
    "/categories/:id",
    authRequired,
    adminOnly,
    async (req, res) => {
      try {
        await pool.query(
          "DELETE FROM categories WHERE id=?",
          [req.params.id]
        );

        res.json({
          success: true,
        });
      } catch (err) {
        console.error("DELETE CATEGORY ERROR:", err);

        res.status(500).json({
          error: "Failed to delete category",
        });
      }
    }
  );

  /* =====================================================
     BRANDS
  ===================================================== */

  router.get("/brands", authRequired, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM brands ORDER BY name ASC"
      );

      res.json(rows);
    } catch (err) {
      console.error("GET BRANDS ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch brands",
      });
    }
  });

  router.post("/brands", authRequired, adminOnly, async (req, res) => {
    try {
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Brand name is required",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO brands (name, description)
         VALUES (?, ?)`,
        [name, description || null]
      );

      res.status(201).json({
        success: true,
        id: result.insertId,
      });
    } catch (err) {
      console.error("CREATE BRAND ERROR:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({
          error: "Brand already exists",
        });
      }

      res.status(500).json({
        error: "Failed to create brand",
      });
    }
  });

  router.put("/brands/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const { name, description, status } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Brand name is required",
        });
      }

      await pool.query(
        `UPDATE brands
         SET name=?, description=?, status=?
         WHERE id=?`,
        [
          name,
          description || null,
          status || "active",
          req.params.id,
        ]
      );

      res.json({
        success: true,
      });
    } catch (err) {
      console.error("UPDATE BRAND ERROR:", err);

      res.status(500).json({
        error: "Failed to update brand",
      });
    }
  });

  router.delete(
    "/brands/:id",
    authRequired,
    adminOnly,
    async (req, res) => {
      try {
        await pool.query(
          "DELETE FROM brands WHERE id=?",
          [req.params.id]
        );

        res.json({
          success: true,
        });
      } catch (err) {
        console.error("DELETE BRAND ERROR:", err);

        res.status(500).json({
          error: "Failed to delete brand",
        });
      }
    }
  );

  /* =====================================================
     SUPPLIERS
  ===================================================== */

  router.get("/suppliers", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM suppliers ORDER BY company_name ASC"
      );

      res.json(rows);
    } catch (err) {
      console.error("GET SUPPLIERS ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch suppliers",
      });
    }
  });

  router.post("/suppliers", authRequired, adminOnly, async (req, res) => {
    try {
      const {
        company_name,
        contact_person,
        email,
        phone,
        gst,
        address,
        city,
        state,
        pincode,
      } = req.body;

      if (!company_name) {
        return res.status(400).json({
          error: "Company name is required",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO suppliers
        (
          company_name,
          contact_person,
          email,
          phone,
          gst,
          address,
          city,
          state,
          pincode
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          company_name,
          contact_person || null,
          email || null,
          phone || null,
          gst || null,
          address || null,
          city || null,
          state || null,
          pincode || null,
        ]
      );

      res.status(201).json({
        success: true,
        id: result.insertId,
      });
    } catch (err) {
      console.error("CREATE SUPPLIER ERROR:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({
          error: "Supplier already exists",
        });
      }

      res.status(500).json({
        error: "Failed to create supplier",
      });
    }
  });

  router.put("/suppliers/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const {
        company_name,
        contact_person,
        email,
        phone,
        gst,
        address,
        city,
        state,
        pincode,
        status,
      } = req.body;

      await pool.query(
        `UPDATE suppliers SET
          company_name=?,
          contact_person=?,
          email=?,
          phone=?,
          gst=?,
          address=?,
          city=?,
          state=?,
          pincode=?,
          status=?
        WHERE id=?`,
        [
          company_name,
          contact_person || null,
          email || null,
          phone || null,
          gst || null,
          address || null,
          city || null,
          state || null,
          pincode || null,
          status || "active",
          req.params.id,
        ]
      );

      res.json({
        success: true,
      });
    } catch (err) {
      console.error("UPDATE SUPPLIER ERROR:", err);

      res.status(500).json({
        error: "Failed to update supplier",
      });
    }
  });

  router.delete(
    "/suppliers/:id",
    authRequired,
    adminOnly,
    async (req, res) => {
      try {
        await pool.query(
          "DELETE FROM suppliers WHERE id=?",
          [req.params.id]
        );

        res.json({
          success: true,
        });
      } catch (err) {
        console.error("DELETE SUPPLIER ERROR:", err);

        res.status(500).json({
          error: "Failed to delete supplier",
        });
      }
    }
  );

  /* =====================================================
     RETAILERS
  ===================================================== */

  router.get("/retailers", authRequired, async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          r.*,
          u.name AS user_name,
          u.email AS user_email
        FROM retailers r
        LEFT JOIN users u ON r.user_id = u.id
        ORDER BY r.name ASC
      `);

      res.json(rows);
    } catch (err) {
      console.error("GET RETAILERS ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch retailers",
      });
    }
  });

  router.post("/retailers", authRequired, adminOnly, async (req, res) => {
    try {
      const {
        retailer_code,
        name,
        shop_name,
        owner_name,
        email,
        mobile,
        gst,
        address,
        city,
        state,
        pincode,
        credit_limit,
      } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Retailer name is required",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO retailers
        (
          retailer_code,
          name,
          shop_name,
          owner_name,
          email,
          mobile,
          gst,
          address,
          city,
          state,
          pincode,
          credit_limit
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          retailer_code || null,
          name,
          shop_name || null,
          owner_name || null,
          email || null,
          mobile || null,
          gst || null,
          address || null,
          city || null,
          state || null,
          pincode || null,
          credit_limit || 0,
        ]
      );

      res.status(201).json({
        success: true,
        id: result.insertId,
      });
    } catch (err) {
      console.error("CREATE RETAILER ERROR:", err);

      res.status(500).json({
        error: "Failed to create retailer",
      });
    }
  });

  router.put("/retailers/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const {
        retailer_code,
        name,
        shop_name,
        owner_name,
        email,
        mobile,
        gst,
        address,
        city,
        state,
        pincode,
        credit_limit,
        status,
      } = req.body;

      await pool.query(
        `UPDATE retailers SET
          retailer_code=?,
          name=?,
          shop_name=?,
          owner_name=?,
          email=?,
          mobile=?,
          gst=?,
          address=?,
          city=?,
          state=?,
          pincode=?,
          credit_limit=?,
          status=?
        WHERE id=?`,
        [
          retailer_code || null,
          name,
          shop_name || null,
          owner_name || null,
          email || null,
          mobile || null,
          gst || null,
          address || null,
          city || null,
          state || null,
          pincode || null,
          credit_limit || 0,
          status || "active",
          req.params.id,
        ]
      );

      res.json({
        success: true,
      });
    } catch (err) {
      console.error("UPDATE RETAILER ERROR:", err);

      res.status(500).json({
        error: "Failed to update retailer",
      });
    }
  });

  router.delete(
    "/retailers/:id",
    authRequired,
    adminOnly,
    async (req, res) => {
      try {
        await pool.query(
          "DELETE FROM retailers WHERE id=?",
          [req.params.id]
        );

        res.json({
          success: true,
        });
      } catch (err) {
        console.error("DELETE RETAILER ERROR:", err);

        res.status(500).json({
          error: "Failed to delete retailer",
        });
      }
    }
  );

  /* =====================================================
     STOCK IN
  ===================================================== */

  router.post("/stock-in", authRequired, adminOnly, async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const {
        supplier_id,
        batch_number,
        notes,
        items,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: "Stock items are required",
        });
      }

      await connection.beginTransaction();

      let totalAmount = 0;

      for (const item of items) {
        totalAmount +=
          Number(item.quantity || 0) *
          Number(item.purchase_price || 0);
      }

      const [stockInResult] = await connection.query(
        `INSERT INTO stock_in
        (
          supplier_id,
          batch_number,
          notes,
          total_amount,
          created_by
        )
        VALUES (?, ?, ?, ?, ?)`,
        [
          supplier_id || null,
          batch_number || null,
          notes || null,
          totalAmount,
          req.user.id,
        ]
      );

      const stockInId = stockInResult.insertId;

      for (const item of items) {
        const quantity = Number(item.quantity);
        const purchasePrice = Number(item.purchase_price || 0);

        if (!item.product_id || quantity <= 0) {
          throw new Error("Invalid product or quantity");
        }

        const [[product]] = await connection.query(
          "SELECT stock FROM products WHERE id=? FOR UPDATE",
          [item.product_id]
        );

        if (!product) {
          throw new Error(`Product ${item.product_id} not found`);
        }

        const previousStock = Number(product.stock || 0);
        const newStock = previousStock + quantity;

        await connection.query(
          `INSERT INTO stock_in_items
          (
            stock_in_id,
            product_id,
            quantity,
            purchase_price,
            expiry_date
          )
          VALUES (?, ?, ?, ?, ?)`,
          [
            stockInId,
            item.product_id,
            quantity,
            purchasePrice,
            item.expiry_date || null,
          ]
        );

        await connection.query(
          `UPDATE products
           SET stock=?,
               purchase_price=?
           WHERE id=?`,
          [
            newStock,
            purchasePrice,
            item.product_id,
          ]
        );

        await connection.query(
          `INSERT INTO inventory_movements
          (
            product_id,
            movement_type,
            quantity,
            prev_stock,
            new_stock,
            reference_type,
            reference_id,
            reason,
            created_by
          )
          VALUES (?, 'IN', ?, ?, ?, 'STOCK_IN', ?, ?, ?)`,
          [
            item.product_id,
            quantity,
            previousStock,
            newStock,
            stockInId,
            "Stock purchase",
            req.user.id,
          ]
        );
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        stockInId,
        totalAmount,
      });
    } catch (err) {
      await connection.rollback();

      console.error("STOCK IN ERROR:", err);

      res.status(500).json({
        error: err.message || "Failed to add stock",
      });
    } finally {
      connection.release();
    }
  });

  /* =====================================================
     INVENTORY
  ===================================================== */

  router.get("/inventory", authRequired, async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          p.id,
          p.name,
          p.sku,
          p.stock,
          p.min_stock_level,
          p.reorder_level,
          ${effectiveThresholdSql("p")} AS effective_reorder_level,
          ${isLowStockSql("p")} AS is_low_stock,
          p.purchase_price,
          p.distributor_price,
          p.retailer_price,
          p.mrp,
          p.status,
          c.name AS category,
          b.name AS brand,
          s.company_name AS supplier
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.is_deleted=0
        ORDER BY p.name ASC
      `);

      res.json(rows);
    } catch (err) {
      console.error("GET INVENTORY ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch inventory",
      });
    }
  });

router.get("/inventory/low-stock", authRequired, async (req, res) => {
    try {
      const [rows] = await pool.query(`
SELECT
id,
name,
sku,
stock,
min_stock_level,
reorder_level,
${effectiveThresholdSql()} AS effective_reorder_level
FROM products
WHERE is_deleted=0
AND stock <= ${effectiveThresholdSql()}
ORDER BY (stock - ${effectiveThresholdSql()}) ASC, name ASC
`);

      res.json(rows);
    } catch (err) {
      console.error("LOW STOCK ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch low stock products",
      });
    }
  });

  /* =====================================================
     INVENTORY MOVEMENTS
  ===================================================== */

  router.get("/inventory-movements", authRequired, async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          im.*,
          p.name AS product_name,
          p.sku,
          u.name AS created_by_name
        FROM inventory_movements im
        JOIN products p ON im.product_id = p.id
        LEFT JOIN users u ON im.created_by = u.id
        ORDER BY im.created_at DESC
        LIMIT 200
      `);

      res.json(rows);
    } catch (err) {
      console.error("GET MOVEMENTS ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch inventory movements",
      });
    }
  });

  /* =====================================================
     DMS DASHBOARD
  ===================================================== */

  router.get("/dashboard", authRequired, async (req, res) => {
    try {
      const [[supplierCount]] = await pool.query(
        "SELECT COUNT(*) total FROM suppliers WHERE status='active'"
      );

      const [[retailerCount]] = await pool.query(
        "SELECT COUNT(*) total FROM retailers WHERE status='active'"
      );

      const [[productCount]] = await pool.query(
        "SELECT COUNT(*) total FROM products WHERE is_deleted=0"
      );

      const [[lowStockCount]] = await pool.query(
        `SELECT COUNT(*) total
         FROM products
         WHERE is_deleted=0
         AND stock <= ${effectiveThresholdSql()}`
      );

      const [[stockValue]] = await pool.query(
        `SELECT
          COALESCE(
            SUM(stock * COALESCE(purchase_price, 0)),
            0
          ) total
         FROM products
         WHERE is_deleted=0`
      );

      const [[stockInCount]] = await pool.query(
        "SELECT COUNT(*) total FROM stock_in"
      );

      res.json({
        suppliers: supplierCount.total,
        retailers: retailerCount.total,
        products: productCount.total,
        lowStock: lowStockCount.total,
        stockValue: stockValue.total,
        stockInCount: stockInCount.total,
      });
    } catch (err) {
      console.error("DMS DASHBOARD ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch DMS dashboard",
      });
    }
  });

  /* =====================================================
     STOCK ADJUSTMENT
  ===================================================== */

  router.post("/stock-adjustment", authRequired, adminOnly, async (req, res) => {
    const conn = await pool.getConnection();

    try {
      const { product_id, quantity, reason } = req.body;

      const delta = Number(quantity);

      if (!product_id || !delta) {
        return res.status(400).json({
          error: "Product and a non-zero quantity are required",
        });
      }

      await conn.beginTransaction();

      const [[product]] = await conn.query(
        "SELECT id, stock FROM products WHERE id=? FOR UPDATE",
        [product_id]
      );

      if (!product) {
        await conn.rollback();
        return res.status(404).json({
          error: "Product not found",
        });
      }

      const prev = Number(product.stock || 0);
      const next = prev + delta;

      if (next < 0) {
        await conn.rollback();
        return res.status(400).json({
          error: `Cannot adjust stock below zero (current: ${prev})`,
        });
      }

      await conn.query(
        "UPDATE products SET stock=? WHERE id=?",
        [next, product_id]
      );

      await conn.query(
        `INSERT INTO inventory_movements
        (
          product_id,
          movement_type,
          quantity,
          prev_stock,
          new_stock,
          reference_type,
          reference_id,
          reason,
          created_by
        )
        VALUES (?, 'ADJUSTMENT', ?, ?, ?, 'ADJUSTMENT', NULL, ?, ?)`,
        [
          product_id,
          Math.abs(delta),
          prev,
          next,
          reason || "Manual adjustment",
          req.user.id,
        ]
      );

      await conn.commit();

      res.json({
        success: true,
        prev_stock: prev,
        new_stock: next,
      });
    } catch (err) {
      await conn.rollback();

      console.error("STOCK ADJUSTMENT ERROR:", err);

      res.status(500).json({
        error: err.message || "Failed to adjust stock",
      });
    } finally {
      conn.release();
    }
  });

  /* =====================================================
     SALES ORDERS (distributor orders with retailers)
  ===================================================== */

  router.get("/sales-orders", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          o.*,
          r.name AS retailer_name,
          r.shop_name AS retailer_shop,
          r.retailer_code,
          (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
          (SELECT i.invoice_no FROM invoices i WHERE i.order_id = o.id) AS invoice_no
        FROM orders o
        LEFT JOIN retailers r ON o.retailer_id = r.id
        ORDER BY o.created_at DESC
        LIMIT 500
      `);

      res.json(rows);
    } catch (err) {
      console.error("GET SALES ORDERS ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch sales orders",
      });
    }
  });

  /* =====================================================
     SALES ORDER TRACKING (status history + transitions)
  ===================================================== */

  router.get("/orders/:id/tracking", authRequired, adminOnly, async (req, res) => {
    try {
      const [orderRows] = await pool.query(
        `SELECT
          o.*,
          r.name AS retailer_name,
          r.shop_name AS retailer_shop,
          r.retailer_code,
          u.name AS salesman_name
        FROM orders o
        LEFT JOIN retailers r ON o.retailer_id = r.id
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id=?`,
        [req.params.id]
      );

      if (!orderRows.length) {
        return res.status(404).json({
          error: "Order not found",
        });
      }

      const [history] = await pool.query(
        `SELECT
          h.id,
          h.status,
          h.note,
          h.prev_status,
          h.created_at,
          u.name AS changed_by_name
        FROM order_status_history h
        LEFT JOIN users u ON h.changed_by = u.id
        WHERE h.order_id=?
        ORDER BY h.id ASC`,
        [req.params.id]
      );

      res.json({
        order: orderRows[0],
        history,
      });
    } catch (err) {
      console.error("ORDER TRACKING ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch order tracking",
      });
    }
  });

  /* =====================================================
     INVOICES
  ===================================================== */

  router.get("/invoices", authRequired, adminOnly, async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          i.*,
          o.customer_name,
          o.retailer_id,
          o.salesman,
          r.name AS retailer_name,
          r.retailer_code
        FROM invoices i
        JOIN orders o ON i.order_id = o.id
        LEFT JOIN retailers r ON o.retailer_id = r.id
        ORDER BY i.invoice_date DESC
      `);

      res.json(rows);
    } catch (err) {
      console.error("GET INVOICES ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch invoices",
      });
    }
  });

  router.get("/invoices/:id", authRequired, adminOnly, async (req, res) => {
    try {
      const [invRows] = await pool.query(
        `SELECT
          i.*,
          o.customer_name,
          o.salesman,
          o.created_at AS order_date,
          r.name AS retailer_name,
          r.shop_name AS retailer_shop,
          r.retailer_code,
          r.address AS retailer_address,
          r.city AS retailer_city,
          r.gst AS retailer_gst
        FROM invoices i
        JOIN orders o ON i.order_id = o.id
        LEFT JOIN retailers r ON o.retailer_id = r.id
        WHERE i.id=?`,
        [req.params.id]
      );

      if (!invRows.length) {
        return res.status(404).json({
          error: "Invoice not found",
        });
      }

      const [items] = await pool.query(
        `SELECT * FROM invoice_items WHERE invoice_id=?`,
        [invRows[0].id]
      );

      res.json({
        invoice: invRows[0],
        items,
      });
    } catch (err) {
      console.error("GET INVOICE DETAIL ERROR:", err);

      res.status(500).json({
        error: "Failed to fetch invoice",
      });
    }
  });

  /* =====================================================
     PAYMENTS
  ===================================================== */

  router.post("/orders/:id/payment", authRequired, adminOnly, async (req, res) => {
    const conn = await pool.getConnection();

    try {
      const orderId = Number(req.params.id);
      const { amount, method, note } = req.body;

      const paymentAmount = Number(amount);

      if (!paymentAmount || paymentAmount <= 0) {
        return res.status(400).json({
          error: "Payment amount must be greater than zero",
        });
      }

      await conn.beginTransaction();

      const [orderRows] = await conn.query(
        "SELECT * FROM orders WHERE id=? FOR UPDATE",
        [orderId]
      );

      if (!orderRows.length) {
        await conn.rollback();
        return res.status(404).json({
          error: "Order not found",
        });
      }

      const order = orderRows[0];

      // A cancelled order must never be turned into a paid one by recording a
      // payment against it (phase 5: payment/order state integrity).
      if (order.status === "cancelled") {
        await conn.rollback();
        return res.status(409).json({
          error: "This order was cancelled and cannot receive a payment",
        });
      }

      // Canonical money contract: total_amount is the subtotal, so the amount
      // actually due is subtotal - discount + gst.
      const totalDue = amountsFromOrder(order).grandTotal;
      const paidSoFar = Number(order.paid_amount || 0);

      if (paidSoFar + paymentAmount > totalDue) {
        await conn.rollback();
        return res.status(400).json({
          error: `Payment exceeds the outstanding balance (₹${(
            totalDue - paidSoFar
          ).toFixed(2)} remaining)`,
        });
      }

      await conn.query(
        `INSERT INTO payments
        (
          order_id,
          amount,
          method,
          note,
          created_by
        )
        VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          paymentAmount,
          method || "cash",
          note || null,
          req.user.id,
        ]
      );

      const newPaid = paidSoFar + paymentAmount;
      const paymentStatus =
        newPaid >= totalDue ? "paid" : newPaid > 0 ? "partially_paid" : "unpaid";

      await conn.query(
        "UPDATE orders SET paid_amount=?, payment_status=? WHERE id=?",
        [newPaid, paymentStatus, orderId]
      );

      await conn.query(
        "UPDATE invoices SET payment_status=? WHERE order_id=?",
        [paymentStatus, orderId]
      );

      await conn.commit();

      res.json({
        success: true,
        paid_amount: newPaid,
        payment_status: paymentStatus,
      });
    } catch (err) {
      await conn.rollback();

      console.error("PAYMENT ERROR:", err);

      res.status(500).json({
        error: err.message || "Failed to record payment",
      });
    } finally {
      conn.release();
    }
  });

  /* =====================================================
     PAYMENTS (admin all-payments view)
  ===================================================== */

  router.get("/payments", authRequired, adminOnly, async (req, res) => {
    try {
      const { search, method, status, from, to } = req.query;

      const conditions = [];
      const params = [];

      if (search) {
        conditions.push(
          "(p.id LIKE ? OR p.order_id LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR i.invoice_no LIKE ?)"
        );
        const like = `%${search}%`;
        params.push(like, like, like, like, like);
      }
      if (method) {
        conditions.push("p.method = ?");
        params.push(method);
      }
      if (status) {
        conditions.push("o.payment_status = ?");
        params.push(status);
      }
      if (from) {
        conditions.push("DATE(p.payment_date) >= ?");
        params.push(from);
      }
      if (to) {
        conditions.push("DATE(p.payment_date) <= ?");
        params.push(to);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      // Pagination. The previous behaviour (a hardcoded LIMIT 200 with no way
      // to page) is preserved as the default so existing screens are unchanged,
      // while large payment books can now be paged.
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
      const page = Math.max(Number(req.query.page) || 1, 1);
      const offset = (page - 1) * limit;

      const [[summary]] = await pool.query(
        `SELECT
           COUNT(*) AS total_payments,
           CAST(COALESCE(SUM(p.amount),0) AS DOUBLE) AS total_collected,
           COUNT(DISTINCT o.user_id) AS paying_customers,
           SUM(o.payment_status='paid') AS paid_count
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN invoices i ON i.order_id = o.id
         ${where}`,
        params
      );

      const [rows] = await pool.query(
        `SELECT
           p.id,
           p.order_id,
           p.amount,
           p.method,
           p.note,
           p.payment_date,
           p.created_at,
           o.payment_status,
           COALESCE(u.name, o.customer_name, 'Customer') AS customer,
           i.invoice_no
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN invoices i ON i.order_id = o.id
         ${where}
         ORDER BY p.payment_date DESC, p.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      res.json({
        summary: {
          totalPayments: Number(summary?.total_payments || 0),
          totalCollected: Number(summary?.total_collected || 0),
          payingCustomers: Number(summary?.paying_customers || 0),
          paidOrders: Number(summary?.paid_count || 0),
        },
        data: rows,
        pagination: { page, limit, total: Number(summary?.total_payments || 0) },
      });
    } catch (err) {
      console.error("GET ADMIN PAYMENTS ERROR:", err);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  });

  /* =====================================================
     REGISTER ROUTER
  ===================================================== */

  app.use("/api/dms", authRequired, adminOnly, router);
}
