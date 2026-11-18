/* =====================================================
   NOTIFICATION SERVICE
   Non-fatal by design: a notification failure must NEVER
   break the main business transaction. Wrap in try/catch.
===================================================== */

const VALID_TYPES = [
  "low_stock",
  "order",
  "payment",
  "delivery",
  "expiry",
  "return",
  "credit",
  "collection",
  "system",
];

/**
 * Insert a notification for a user.
 * `pool` is the shared mysql2 connection pool.
 * Returns the new id on success, or null on failure (never throws).
 */
export async function createNotification(pool, entry) {
  try {
    const type = VALID_TYPES.includes(entry.type) ? entry.type : "system";
    const [r] = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.userId ?? null,
        entry.title || "Notification",
        entry.message || "",
        type,
        entry.referenceType || null,
        entry.referenceId ?? null,
      ]
    );
    return r.insertId;
  } catch (err) {
    console.error("NOTIFICATION ERROR:", err);
    return null;
  }
}
