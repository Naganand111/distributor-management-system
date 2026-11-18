// backend/sql/src/config/jwt.js
//
// Single source of truth for the JWT secret across the whole backend.
// Reads ONLY from process.env.JWT_SECRET. Fails fast at startup when it is
// missing or too short so the server never runs with a weak/fallback secret.

const MIN_JWT_SECRET_LENGTH = 32;

function loadJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || !String(secret).trim()) {
    throw new Error(
      "JWT_SECRET is required. Set it in backend/.env (or the environment). Use a long random value (at least " +
        MIN_JWT_SECRET_LENGTH +
        " characters)."
    );
  }

  if (String(secret).length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      "JWT_SECRET is too short. Use at least " + MIN_JWT_SECRET_LENGTH + " characters."
    );
  }

  return String(secret);
}

export const JWT_SECRET = loadJwtSecret();