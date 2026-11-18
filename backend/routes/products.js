import multer from "multer";
import { effectiveThresholdSql, isLowStockSql } from "../utils/inventoryThreshold.js";

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

/* ✅ VALIDATION */
function validateProduct({ name, price, stock, description }, isUpdate = false) {
  if (!isUpdate) {
    if (!name?.trim?.() || price == null || stock == null) {
      return "Name, price, and stock are required";
    }
  }

  if (name != null && typeof name !== "string") return "Invalid name";
  if (name && name.length > 100) return "Name too long";
  if (description != null && typeof description !== "string")
    return "Invalid description";
  if (description && description.length > 500) return "Description too long";

  if (price != null) {
    const parsedPrice = Number(price);
    if (
      (typeof price !== "number" && typeof price !== "string") ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0 ||
      parsedPrice > 99999999
    ) {
      return "Invalid price";
    }
  }

  if (stock != null) {
    // stock is an INT column: require a whole, non-negative number so values
    // are never silently rounded or coerced.
    const parsedStock = Number(stock);
    if (
      (typeof stock !== "number" && typeof stock !== "string") ||
      !Number.isInteger(parsedStock) ||
      parsedStock < 0 ||
      parsedStock > 100000000
    ) {
      return "Invalid stock";
    }
  }

  return null;
}

/* Parse a CSV string into an array of objects keyed by the header row.
   Handles quoted fields containing commas/quotes/newlines (RFC 4180). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .map((r) => r.map((c) => (c ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));
}

export default function registerProductRoutes(app, pool, authRequired, adminOnly) {
  const guard = [authRequired, adminOnly];

  /* 🔹 GET PRODUCTS */
  app.get("/api/products", async (req, res) => {
    try {
      const search = (req.query.search || req.query.q || "").toLowerCase();
      const category = req.query.category ? Number(req.query.category) : 0;
      const brand = req.query.brand ? Number(req.query.brand) : 0;
      const min = req.query.min ? Number(req.query.min) : 0;
      const max = req.query.max ? Number(req.query.max) : 0;
      // If present, restrict to active / in-stock (used by the customer shop).
      const activeOnly = req.query.active === "1" || req.query.active === "true";
      const inStockOnly = req.query.inStock === "1" || req.query.inStock === "true";

      let where = "p.is_deleted=0";
      const params = [];

      if (search) {
        where += " AND LOWER(p.name) LIKE ?";
        params.push(`%${search}%`);
      }
      if (category) {
        where += " AND p.category_id=?";
        params.push(category);
      }
      if (brand) {
        where += " AND p.brand_id=?";
        params.push(brand);
      }
      if (activeOnly) {
        where += " AND p.status='active'";
      }
      if (inStockOnly) {
        where += " AND p.stock > 0";
      }
      if (min > 0) {
        where += " AND p.price >= ?";
        params.push(min);
      }
      if (max > 0) {
        where += " AND p.price <= ?";
        params.push(max);
      }

      const [rows] = await pool.query(
        `SELECT
           p.id, p.name, p.price, p.stock, p.description,
           p.status,
           IFNULL(p.sku, '') AS sku,
           IFNULL(p.mrp, 0) AS mrp,
           p.category_id, p.brand_id,
           IFNULL(c.name, '') AS category,
           IFNULL(b.name, '') AS brand,
IFNULL(p.image, '') AS image,
p.reorder_level, p.min_stock_level,
${isLowStockSql("p")} AS is_low_stock,
${effectiveThresholdSql("p")} AS effective_reorder_level,
(SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id) AS avg_rating,
(SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS rating_count
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN brands b ON p.brand_id = b.id
WHERE ${where}
ORDER BY p.id DESC`,
        params
      );

      res.json({ success: true, data: rows });
    } catch (err) {
      console.error("GET PRODUCTS ERROR:", err);
      res.status(500).json({ success: false });
    }
  });

  /* 🔹 GET SINGLE PRODUCT (customer-safe fields) */
  app.get("/api/products/:id", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT
           p.id, p.name, p.price, p.stock, p.description,
           p.status,
           IFNULL(p.sku, '') AS sku,
           IFNULL(p.mrp, 0) AS mrp,
           p.category_id, p.brand_id,
           IFNULL(c.name, '') AS category,
           IFNULL(b.name, '') AS brand,
           IFNULL(p.image, '') AS image,
           (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id) AS avg_rating,
           (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS rating_count
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN brands b ON p.brand_id = b.id
         WHERE p.id=? AND p.is_deleted=0`,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("GET PRODUCT ERROR:", err);
      res.status(500).json({ success: false });
    }
  });

  /* 🔹 GET REVIEWS FOR A PRODUCT */
  app.get("/api/products/:id/reviews", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS author
         FROM reviews r
         JOIN users u ON u.id = r.user_id
         WHERE r.product_id = ?
         ORDER BY r.created_at DESC`,
        [req.params.id]
      );

      res.json({ success: true, data: rows });
    } catch (err) {
      console.error("GET REVIEWS ERROR:", err);
      res.status(500).json({ success: false });
    }
  });

  /* 🔹 GET CURRENT USER'S REVIEW FOR A PRODUCT */
  app.get("/api/products/:id/reviews/mine", authRequired, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, rating, comment, created_at
         FROM reviews
         WHERE product_id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
      );

      res.json({ success: true, data: rows[0] || null });
    } catch (err) {
      console.error("GET MY REVIEW ERROR:", err);
      res.status(500).json({ success: false });
    }
  });

  /* 🔹 ADD / UPDATE A REVIEW (only customers who purchased the product) */
  app.post("/api/products/:id/reviews", authRequired, async (req, res) => {
    try {
      const productId = req.params.id;
      const { rating, comment } = req.body;

      const r = Number(rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) {
        return res.status(400).json({ message: "Rating must be 1-5" });
      }

      // Must have purchased this product previously
      const [purchased] = await pool.query(
        `SELECT oi.id
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = ? AND o.user_id = ?
         LIMIT 1`,
        [productId, req.user.id]
      );

      if (purchased.length === 0) {
        return res.status(403).json({
          message: "You can only review products you have purchased",
        });
      }

      await pool.query(
        `INSERT INTO reviews (product_id, user_id, rating, comment)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           rating = VALUES(rating),
           comment = VALUES(comment)`,
        [productId, req.user.id, r, (comment || "").trim() || null]
      );

      const [rows] = await pool.query(
        `SELECT id, rating, comment, created_at
         FROM reviews
         WHERE product_id = ? AND user_id = ?`,
        [productId, req.user.id]
      );

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("POST REVIEW ERROR:", err);
      res.status(500).json({ success: false });
    }
  });

  /* 🔹 DELETE A REVIEW (owner or admin only) */
  app.delete(
    "/api/products/:id/reviews/:reviewId",
    authRequired,
    async (req, res) => {
      try {
        const { id, reviewId } = req.params;

        const [rows] = await pool.query(
          `SELECT user_id FROM reviews WHERE id = ? AND product_id = ?`,
          [reviewId, id]
        );

        if (rows.length === 0) {
          return res.status(404).json({ message: "Review not found" });
        }

        if (req.user.role !== "admin" && rows[0].user_id !== req.user.id) {
          return res.status(403).json({ message: "Access denied" });
        }

        await pool.query("DELETE FROM reviews WHERE id = ?", [reviewId]);

        res.json({ success: true });
      } catch (err) {
        console.error("DELETE REVIEW ERROR:", err);
        res.status(500).json({ success: false });
      }
    }
  );

  /* 🔹 CREATE PRODUCT */
  app.post(
    "/api/products",
    ...guard,
    // NOTE: image upload (if any) is handled by the multer instance wired in server.js
    async (req, res) => {
      try {
        const error = validateProduct(req.body);
        if (error) return res.status(400).json({ message: error });

        const { name, price, stock, description, image } = req.body;

        const [result] = await pool.query(
          `INSERT INTO products (name, price, stock, description, image)
           VALUES (?, ?, ?, ?, ?)`,
          [name.trim(), price, stock, description || "", image || ""]
        );

        const [newProduct] = await pool.query(
          `SELECT id, name, price, stock, description, IFNULL(image, '') AS image
           FROM products WHERE id=?`,
          [result.insertId]
        );

        res.json({ success: true, data: newProduct[0] });
      } catch (err) {
        console.error("CREATE ERROR:", err);
        res.status(500).json({ success: false });
      }
    }
  );

  /* 🔹 IMPORT PRODUCTS FROM CSV (admin only) */
  app.post(
    "/api/products/import",
    ...guard,
    csvUpload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No CSV file uploaded" });
        }

        const text = req.file.buffer.toString("utf8");
        const raw = parseCsv(text);

        if (raw.length < 2) {
          return res.status(400).json({ message: "CSV must have a header row" });
        }

        const headers = raw[0].map((h) => h.toLowerCase());
        const col = (name) => headers.indexOf(name);

        const idxId = col("id");
        const idxName = col("name");
        const idxPrice = col("price");
        const idxStock = col("stock");
        const idxDesc = col("description");
        const idxImage = col("image");

        if (idxName === -1 || idxPrice === -1 || idxStock === -1) {
          return res.status(400).json({
            message: "CSV must contain at least name, price and stock columns",
          });
        }

        const created = [];
        const updated = [];
        const errors = [];

        for (let i = 1; i < raw.length; i++) {
          const row = raw[i];
          const rowNum = i + 1;
          const cell = (idx) => (idx > -1 ? row[idx] ?? "" : "");

          const name = cell(idxName);
          const price = Number(cell(idxPrice));
          const stock = Number(cell(idxStock));

          if (!name) {
            errors.push({ row: rowNum, message: "Missing name" });
            continue;
          }
          if (isNaN(price) || price < 0) {
            errors.push({ row: rowNum, message: `Invalid price: ${cell(idxPrice)}` });
            continue;
          }
          if (isNaN(stock) || stock < 0) {
            errors.push({ row: rowNum, message: `Invalid stock: ${cell(idxStock)}` });
            continue;
          }

          const desc = cell(idxDesc);
          const image = cell(idxImage);
          const id = idxId > -1 && cell(idxId) !== "" ? Number(cell(idxId)) : null;

          try {
            // 1) match by explicit id
            if (id) {
              const [existing] = await pool.query(
                "SELECT id FROM products WHERE id=? AND is_deleted=0",
                [id]
              );
              if (existing.length) {
                await pool.query(
                  `UPDATE products SET name=?, price=?, stock=?, description=?, image=? WHERE id=?`,
                  [name, price, stock, desc, image, id]
                );
                updated.push(id);
                continue;
              }
            }

            // 2) match by name (case-insensitive)
            const [byName] = await pool.query(
              "SELECT id FROM products WHERE LOWER(TRIM(name)) = ? AND is_deleted=0",
              [String(name).toLowerCase().trim()]
            );

            if (byName.length) {
              await pool.query(
                `UPDATE products SET name=?, price=?, stock=?, description=?, image=? WHERE id=?`,
                [name, price, stock, desc, image, byName[0].id]
              );
              updated.push(byName[0].id);
              continue;
            }

            // 3) create new
            const [result] = await pool.query(
              `INSERT INTO products (name, price, stock, description, image)
               VALUES (?, ?, ?, ?, ?)`,
              [name, price, stock, desc, image]
            );
            created.push(result.insertId);
          } catch (err) {
            console.error("IMPORT ROW ERROR:", err);
            errors.push({ row: rowNum, message: err.sqlMessage || err.message });
          }
        }

        res.json({
          success: true,
          summary: { created: created.length, updated: updated.length, failed: errors.length },
          created,
          updated,
          errors,
        });
      } catch (err) {
        console.error("IMPORT ERROR:", err);
        res.status(500).json({ success: false, message: "Import failed" });
      }
    }
  );

  /* 🔹 UPDATE PRODUCT */
  app.put(
    "/api/products/:id",
    ...guard,
    async (req, res) => {
      const connection = await pool.getConnection();

      try {
        const { id } = req.params;
        const { name, price, stock, description, image, removeImage } = req.body;

        const error = validateProduct(req.body, true);
        if (error) {
          await connection.rollback();
          return res.status(400).json({ message: error });
        }

        const productId = Number(id);
        if (!Number.isInteger(productId) || productId <= 0) {
          await connection.rollback();
          return res.status(400).json({ message: "Invalid product id" });
        }

        await connection.beginTransaction();

        // Lock the product row so a concurrent sale cannot be overwritten by
        // the absolute stock value supplied by this request.
        const [[old]] = await connection.query(
          "SELECT id, image, stock FROM products WHERE id=? AND is_deleted=0 FOR UPDATE",
          [productId]
        );

        if (!old) {
          await connection.rollback();
          return res
            .status(404)
            .json({ success: false, message: "Product not found" });
        }

        let imageValue = old.image || "";

        if (removeImage === "true" || removeImage === true) {
          imageValue = "";
        }

        if (req.body.image && req.body.image !== imageValue) {
          imageValue = req.body.image;
        }

        const [result] = await connection.query(
          `UPDATE products
           SET name=?, price=?, stock=?, description=?, image=?
           WHERE id=? AND is_deleted=0`,
          [name, price, stock, description || "", imageValue, productId]
        );

        if (result.affectedRows === 0) {
          await connection.rollback();
          return res
            .status(404)
            .json({ success: false, message: "Product not found" });
        }

        // Stock changed through a product edit: record it as an ADJUSTMENT so
        // the inventory movement history stays a complete audit trail.
        const prevStock = Number(old.stock || 0);
        const newStock = Number(stock);

        if (Number.isInteger(newStock) && newStock !== prevStock) {
          await connection.query(
            `INSERT INTO inventory_movements
             (product_id, movement_type, quantity, prev_stock, new_stock, reference_type, reference_id, reason, created_by)
             VALUES (?, 'ADJUSTMENT', ?, ?, ?, 'PRODUCT_EDIT', ?, 'Product details updated', ?)`,
            [
              productId,
              Math.abs(newStock - prevStock),
              prevStock,
              newStock,
              productId,
              req.user?.id || null,
            ]
          );
        }

        await connection.commit();

        const [updated] = await pool.query(
          `SELECT id, name, price, stock, description, IFNULL(image, '') AS image
           FROM products WHERE id=?`,
          [productId]
        );

        res.json({ success: true, data: updated[0] });
      } catch (err) {
        await connection.rollback();
        console.error("UPDATE ERROR:", err);
        res.status(500).json({ success: false });
      } finally {
        connection.release();
      }
    }
  );

  /* 🔹 DELETE PRODUCT (soft) */
  app.delete("/api/products/:id", ...guard, async (req, res) => {
    try {
      await pool.query("UPDATE products SET is_deleted=1 WHERE id=?", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE ERROR:", err);
      res.status(500).json({ success: false });
    }
  });
}
