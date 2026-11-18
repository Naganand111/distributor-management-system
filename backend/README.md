# OMS Backend (Node.js + MySQL)

See the root `README.md` for the full setup, environment and deployment guide.

## Setup
1. Copy `.env.example` to `.env` and fill values (DB credentials, `JWT_SECRET`, `CORS_ORIGIN`).
2. `npm install`
3. Create + migrate the database: `node sql/migrate.mjs` (applies `sql/schema.sql` and every file in `sql/migrations/`).
4. `npm start` (or `npm run dev`)

The server refuses to start if `JWT_SECRET` (min 32 chars) or `DB_HOST` / `DB_USER` / `DB_NAME` are missing.

## Endpoints
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET  /api/products` (public)
- `POST /api/products` (admin)
- `PUT  /api/products/:id` (admin)
- `DELETE /api/products/:id` (admin)
- `POST /api/orders` (customer)
- `GET  /api/orders/mine` (customer)
- `GET  /api/orders` (admin)
- `PUT  /api/orders/:id/status` (admin)
- `GET  /api/orders/:id` (auth)
