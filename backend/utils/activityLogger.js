/* =====================================================
   ACTIVITY / AUDIT LOGGER
   Non-fatal by design: a logging failure must NEVER break
   the main business transaction. Wrap in try/catch.
===================================================== */

/**
 * Insert an activity log row.
 * `pool` is the shared mysql2 connection pool.
 * Returns true on success, false on failure (never throws).
 */
export async function logActivity(pool, entry) {
  try {
    await pool.query(
      `INSERT INTO activity_logs
       (user_id, action, module, description, reference_type, reference_id, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.userId ?? null,
        entry.action || null,
        entry.module || null,
        entry.description || null,
        entry.referenceType || null,
        entry.referenceId ?? null,
        entry.ipAddress || null,
      ]
    );
    return true;
  } catch (err) {
    console.error("ACTIVITY LOG ERROR:", err);
    return false;
  }
}
