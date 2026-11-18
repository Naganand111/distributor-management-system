/* Central API configuration.
 *
 * The API base URL MUST come from REACT_APP_API_URL (see frontend/.env.example).
 * There is intentionally NO hardcoded localhost fallback, so a production build
 * can never embed a development URL.
 *
 * Local development: create frontend/.env.local with
 *   REACT_APP_API_URL=http://localhost:5000/api
 * Production: set
 *   REACT_APP_API_URL=https://api.example.com/api
 */

const API_URL = process.env.REACT_APP_API_URL;

if (!API_URL) {
  throw new Error(
    "REACT_APP_API_URL is not set. Copy frontend/.env.example to frontend/.env.local and set REACT_APP_API_URL (e.g. http://localhost:5000/api for local development, or https://api.example.com/api in production)."
  );
}

export const API_BASE_URL = String(API_URL).replace(/\/+$/, "");

export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
