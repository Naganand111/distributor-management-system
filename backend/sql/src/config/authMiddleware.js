// backend/sql/src/middleware/auth.js
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/jwt.js"; // ✅ shared secret

/**
 * Shared connection pool. server.js injects its own pool at boot so this
 * middleware enforces the same live-session rule as the main authRequired.
 * Without it, logout / session revocation would be bypassable here.
 */
let authPool = null;

export function setAuthPool(pool) {
  authPool = pool;
}

/** Access tokens are stored as SHA-256 digests, never as raw tokens. */
export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Middleware: Require valid token
 */
export async function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET); // use shared secret

    // Fail closed if the session store is unavailable, otherwise a revoked
    // token would still authenticate through this path.
    if (!authPool) {
      return res.status(401).json({ error: "Session store unavailable" });
    }

    const [sessions] = await authPool.query(
      "SELECT id FROM user_sessions WHERE token=? AND is_active=1 LIMIT 1",
      [hashToken(token)]
    );

    if (sessions.length === 0) {
      return res.status(401).json({ error: "Session expired or revoked" });
    }

    req.user = payload; // { id, role, name, email }
    req.sessionId = sessions[0].id;
    next();
  } catch (err) {
    console.error("JWT verification failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Middleware: Require admin role
 */
export function adminOnly(req, res, next) {
  if (!req.user)
    return res.status(401).json({ error: "Authentication required" });
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin access only" });
  next();
}

/**
 * Middleware: Allow role-based access (flexible)
 */
export function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "Access denied" });
    next();
  };
}
