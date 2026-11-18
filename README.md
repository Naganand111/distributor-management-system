# Distributor Management System (OMS + DMS)

A locally runnable full-stack **Order Management** and **Distributor Management** system: a React admin console, a customer storefront, an Express REST API, and MySQL.

This repository is intended for local development, portfolio review, and technical interviews. **It is not a hosted product.** There is no public demo URL in this project.

---

## Project overview

The application supports two primary experiences:

- **Customers** register, browse products, place orders (cash or Razorpay), track fulfilment, view invoices and payments, and ask a scoped assistant about their own data.
- **Administrators** manage catalog, inventory, distribution, finance, reporting, security, and optional AI narration of operational queries.

Authentication uses JWT and bcrypt. Public registration always creates a **customer**. Privileged accounts are created by an administrator (or by promoting a user in the database). Optional LLM narration is **off by default**.

---

## Key features

### Customer features

- Register, log in, log out, and reset a password with a hashed OTP
- Shop catalog, product detail, and purchase-gated product reviews
- Cart and checkout with promotion codes; totals are calculated on the server
- Cash or Razorpay online payment (gateway amounts come from the order row, not the client)
- Order history, status tracking, cancellation, invoices, and payment history
- Profile and password change, in-app notifications
- Loyalty balance, history, and redeem-against-order
- Customer AI assistant (`/customer-ai`) scoped to the signed-in user

### Admin features

- Dashboard and analytics
- Products (including CSV import), categories, and brands
- Inventory, stock-in, stock history, low-stock threshold, smart reorder, warehouses and transfers, barcode / QR lookup
- Customer orders and status changes, retailers, sales representatives (records, targets, commissions), territories
- Sales routes, retailer visits, and deliveries (admin-managed; not a driver/rep login app)
- Suppliers and purchase orders
- Billing, invoices, payments, profit and margins, retailer credit and collections, reports (PDF, CSV, Excel)
- Promotions, returns, damaged and expired stock
- Global search, security centre (sessions and audit-style events), loyalty configuration, companies and branches, activity logs, customer user management
- Admin AI assistant (`/admin/assistant`)

---

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, React Router 7, Vite 7, Bootstrap 5, Axios, Chart.js / Recharts, Framer Motion |
| Backend | Node.js (ES modules), Express 4, mysql2, JSON Web Tokens, bcryptjs, Helmet, CORS, express-rate-limit, Multer, PDFKit, json2csv, Razorpay, write-excel-file |
| Database | MySQL |
| Optional LLM | OpenAI or Cohere chat APIs (`LLM_ENABLED` is false unless you turn it on) |
| Tests | Node.js built-in test runner (`backend/tests/`) |

There is no root workspace `package.json`. Backend and frontend are installed and started separately.

---

## System architecture

```
Browser (Vite, default http://localhost:5173)
        │
        │  REACT_APP_API_URL  (must include /api)
        ▼
Express API (backend/server.js, default http://localhost:5000)
        │
        ├── JWT auth, Helmet, CORS, rate limits
        ├── Feature routers in backend/routes/
        ├── Users and order list/detail in backend/sql/src/routes/
        └── mysql2 pool
                ▼
            MySQL database (DB_NAME, typically oms)
```

- The frontend reads `REACT_APP_API_URL` at **build / dev start** via Vite (`frontend/vite.config.mjs` and `frontend/src/lib/config.js`). There is no compiled-in localhost fallback.
- Authenticated requests send `Authorization: Bearer <token>`.
- Invoice downloads use that header only; tokens in query strings are not accepted.

---

## User roles and permissions

After migration `008_dms_enterprise.sql`, `users.role` is `ENUM('admin','customer','sales_rep','delivery')`.

| Role | Login UI | How it is used |
| --- | --- | --- |
| `customer` | Storefront (`/shop`, `/customer-dashboard`, …) | Created by public registration. Can only access their own orders, invoices, payments, and customer AI. |
| `admin` | Admin console (`/admin/*`) | Full operations UI. Staff users are created with `POST /api/users` (allowed roles there: `admin` or `customer`). |
| `sales_rep` | **None** | Stored on the user table, but there is no sales-rep frontend. Field reps are managed as **records** under Sales Reps (`sales_representatives`). Admin and customer AI tools **refuse** this role. |
| `delivery` | **None** | Same as above. Deliveries and delivery persons are admin-managed records, not a driver app. AI tools **refuse** this role. |

The React router only distinguishes **admin** vs **customer**. A user whose role is `sales_rep` or `delivery` has no dedicated screens.

---

## Project structure

```
oms-react-mysql/
├── README.md                 ← this file
├── .gitignore
├── backend/
│   ├── server.js             ← API entry point
│   ├── package.json
│   ├── .env.example
│   ├── routes/               ← feature modules mounted from server.js
│   ├── services/             ← AI / LLM helpers
│   ├── sql/
│   │   ├── schema.sql        ← baseline schema
│   │   ├── migrations/       ← 001–011 incremental SQL
│   │   ├── migrate.mjs       ← applies baseline + migrations
│   │   └── src/              ← JWT helpers; mounted users + orders routers
│   ├── tests/
│   └── utils/
└── frontend/
    ├── package.json
    ├── vite.config.mjs
    ├── .env.example
    └── src/
        ├── App.js            ← routes
        ├── components/       ← pages and layouts
        └── lib/              ← API client, auth, config
```

`backend/README.md` is a short pointer and a **partial** endpoint list. This root README is the source of truth.

---

## Prerequisites

- **Node.js** — Vite 7 is used; **Node 20 LTS or later** is recommended. A specific version is not pinned in `package.json`.
- **npm**
- **MySQL 8** (or compatible), running locally or on a host you control
- A MySQL user that can create tables in the application database

Optional:

- A Razorpay account for online checkout
- SMTP (or SMS) credentials for password-reset delivery
- An OpenAI or Cohere API key if you want LLM-narrated assistant answers

---

## Installation and setup

Clone or copy this project, then use two terminals.

### 1. Create the database

In a MySQL client:

```sql
CREATE DATABASE oms CHARACTER SET utf8mb4;
```

### 2. Backend

```bash
cd backend
copy .env.example .env
# macOS / Linux: cp .env.example .env
```

Edit `backend/.env` (names only — never commit real values):

- Set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- Set `JWT_SECRET` to a long random string (**at least 32 characters**)
- Set `CORS_ORIGIN` to the frontend origin Vite will use (see below)

```bash
npm install
node sql/migrate.mjs
npm start
```

For auto-reload during development:

```bash
npm run dev
```

The API listens on `PORT` (default **5000**). `GET http://localhost:5000/api/health` should report the service and database status.

The process **exits on startup** if `JWT_SECRET` is missing or shorter than 32 characters, or if `DB_HOST`, `DB_USER`, or `DB_NAME` is missing.

### 3. Frontend

Vite does **not** set `server.port` in `vite.config.mjs`, so the dev server uses Vite’s default: **http://localhost:5173**.

`backend/.env.example` currently shows `CORS_ORIGIN=http://localhost:3000`. For a default Vite session you must allow **5173**:

```text
CORS_ORIGIN=http://localhost:5173
```

If Vite prints a different port (for example if 5173 is busy), put that origin in `CORS_ORIGIN` instead.

```bash
cd frontend
copy .env.example .env.local
# macOS / Linux: cp .env.example .env.local
```

Set in `frontend/.env.local`:

```text
REACT_APP_API_URL=http://localhost:5000/api
```

Optionally set `REACT_APP_RAZORPAY_KEY_ID` for checkout.

```bash
npm install
npm start
```

Open the URL Vite prints (typically `http://localhost:5173`).

Production frontend build (API URL is baked in at build time):

```bash
cd frontend
# Windows example:
set REACT_APP_API_URL=https://your-api-host/api
npm run build
```

Output directory: `frontend/build`. Preview with `npm run preview`.

### 4. Create the first administrator

Registration **always** inserts `role = 'customer'`. A client cannot self-register as admin.

After you register with your own email, promote that row in MySQL (use **your** email, not a sample password):

```sql
UPDATE users
SET role = 'admin', company_id = 1, branch_id = 1, is_active = 1
WHERE email = 'you@example.com';
```

Then log in again. An admin can also create staff with `POST /api/users` (`role` `admin` or `customer` only).

---

## Environment configuration

Documented **names** only. Copy the example files; do not commit `.env` or `.env.local`.

### Backend (`backend/.env`, see `backend/.env.example`)

| Variable | When required | Purpose |
| --- | --- | --- |
| `PORT` | no | API port (default `5000`) |
| `NODE_ENV` | production | Enables trust-proxy and stricter CORS |
| `DB_HOST` | yes | MySQL host |
| `DB_PORT` | no | MySQL port (default `3306`) |
| `DB_USER` | yes | Database user |
| `DB_PASSWORD` | yes in real deployments | Database password |
| `DB_NAME` | yes | Database name (for example `oms`) |
| `JWT_SECRET` | yes | Signing secret, minimum 32 characters |
| `CORS_ORIGIN` | yes in production; needed locally too | Comma-separated frontend origins. `*` is rejected when `NODE_ENV=production` |

| `RAZORPAY_KEY_ID` | online payments | Razorpay key id |
| `RAZORPAY_KEY_SECRET` | online payments | Razorpay secret (backend only) |
| `UPLOAD_BASE_URL` | production | Public origin used to build upload URLs |
| `UPLOAD_DIR` | no | Upload directory (default `uploads`) |
| `RESET_DEV_LOG` | local only | If `true` and not production, prints password-reset OTP to the **server console** |
| `MAIL_HOST` | production password reset | SMTP host |
| `MAIL_PORT` | with mail | SMTP port |
| `MAIL_USER` | with mail | SMTP user |
| `MAIL_PASSWORD` | with mail | SMTP password |
| `MAIL_FROM` | with mail | From address |
| `SMS_PROVIDER_API_KEY` | alternative OTP delivery | SMS provider key |
| `LLM_ENABLED` | no | Master switch; default off — no provider is constructed |
| `LLM_PROVIDER` | when LLM is on | `openai`, `cohere`, or `mock` (tests only) |
| `LLM_API_KEY` | when LLM is on | Server-side provider key |
| `LLM_MODEL` | when LLM is on | Model identifier |
| `LLM_BASE_URL` | no | Optional endpoint override (`https` required in production) |
| `LLM_MAX_TOKENS` | no | Generation cap |
| `LLM_TEMPERATURE` | no | Sampling temperature |
| `LLM_TIMEOUT_MS` | no | Provider timeout |
| `LLM_MAX_TOOL_ITERATIONS` | no | Iteration cap |

Never prefix LLM or Razorpay **secret** names with `REACT_APP_`. That prefix is compiled into the frontend bundle.

### Internal testing-only environment variables

| Variable | When required | Purpose |
| --- | --- | --- |
| `OMS_TEST_GATEWAY` | testing only | Used by the payment gateway test seam; not a production configuration option. |


### Frontend (`frontend/.env.local`, see `frontend/.env.example`)

| Variable | When required | Purpose |
| --- | --- | --- |
| `REACT_APP_API_URL` | yes | API base URL **including** `/api` (local example: `http://localhost:5000/api`) |
| `REACT_APP_RAZORPAY_KEY_ID` | checkout | Publishable Razorpay key only |

If `REACT_APP_API_URL` is missing, the frontend throws at startup (`frontend/src/lib/config.js`).

---

## Database setup and migrations

1. Create an empty database (see Installation).
2. From `backend/`, run:

```bash
node sql/migrate.mjs
```

The runner:

- Loads `backend/.env` through `dotenv/config`
- Applies `sql/schema.sql`, then every `sql/migrations/NNN_*.sql` in order
- Records applied files in `schema_migrations`
- Is idempotent; re-running is safe for already-applied files
- Parses `DELIMITER` blocks for procedures and does not send `DELIMITER` to MySQL

MySQL auto-commits DDL, so a migration is marked applied only when its statements succeed.

Published schema files:

- `backend/sql/schema.sql`
- `backend/sql/migrations/001_align_order_schema.sql` through `011_payment_integrity.sql`

Other `.sql` files in the tree (for example seed scripts) are **gitignored** by `*.sql` except the schema and migrations exceptions.

---

## API documentation

Base URL: `http://localhost:5000`. JSON APIs under `/api`. Unless noted, send `Authorization: Bearer <token>`.

Users and orders routes are served from `backend/sql/src/routes/` (`users.js`, `orders.js`). All other endpoints come from `server.js` and `backend/routes/`.

### Health

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/` | Public — API running message |
| `GET` | `/api/health` | Public — process + database check |

### Authentication

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Public; always creates `customer` |
| `POST` | `/api/auth/login` | Public |
| `POST` | `/api/auth/logout` | Session end |
| `POST` | `/api/auth/forgot-password` | Public, rate-limited |
| `POST` | `/api/auth/verify-otp` | Public, rate-limited |
| `POST` | `/api/auth/reset-password` | Public, rate-limited |

### Users (admin)

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/users` | Admin (customer list) |
| `GET` | `/api/users/:id` | Admin |
| `GET` | `/api/users/:id/overview` | Admin |
| `POST` | `/api/users` | Admin; `role` `admin` or `customer` |
| `DELETE` | `/api/users/:id` | Admin; customers only |

### Products and reviews

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/products` | Public |
| `GET` | `/api/products/:id` | Public |
| `GET` | `/api/products/:id/reviews` | Public |
| `GET` | `/api/products/:id/reviews/mine` | Authenticated |
| `POST` | `/api/products/:id/reviews` | Authenticated (must have purchased) |
| `DELETE` | `/api/products/:id/reviews/:reviewId` | Owner or admin |
| `POST` | `/api/products` | Admin |
| `POST` | `/api/products/import` | Admin (CSV) |
| `PUT` | `/api/products/:id` | Admin |
| `DELETE` | `/api/products/:id` | Admin |

### Orders and payments

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/orders` | Authenticated |
| `GET` | `/api/orders` | Admin |
| `GET` | `/api/orders/mine` | Authenticated (own) |
| `GET` | `/api/orders/my-orders` | Authenticated (own, customer panel) |
| `GET` | `/api/orders/:id` | Owner or admin |
| `GET` | `/api/orders/:id/invoice` | Owner or admin; `Authorization` header only |
| `PUT` | `/api/orders/:id/status` | Admin |
| `POST` | `/api/orders/:id/cancel` | Authenticated (owner rules apply in handler) |
| `POST` | `/api/payment/create-order` | Authenticated |
| `POST` | `/api/payment/verify` | Authenticated |

Legacy redirect: `GET /orders/:id/invoice` → `/api/orders/:id/invoice` (query string dropped).

### Uploads, dashboard, billing, settings

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/upload` | Admin; JPEG/PNG/WebP, 5 MB, magic-byte check |
| `GET` | `/api/dashboard/full` | Admin |
| `GET` | `/api/billing` | Admin (`from` and `to` query dates) |
| `GET` | `/api/settings/low-stock` | Admin |
| `PUT` | `/api/settings/low-stock` | Admin |

### Customer panel

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/customer/dashboard` | Customer |
| `GET` | `/api/retailers/customer-list` | Customer |
| `GET` | `/api/orders/:id/tracking` | Customer |
| `GET` | `/api/invoices/my-invoices` | Customer |
| `GET` | `/api/invoices/:id` | Customer |
| `GET` | `/api/payments/my-payments` | Customer |
| `GET` | `/api/profile` | Customer |
| `PUT` | `/api/profile` | Customer |
| `PUT` | `/api/profile/change-password` | Customer |

### Notifications

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/notifications` | Authenticated |
| `GET` | `/api/notifications/unread-count` | Authenticated |
| `PUT` | `/api/notifications/:id/read` | Authenticated |
| `PUT` | `/api/notifications/read-all` | Authenticated |
| `DELETE` | `/api/notifications/:id` | Authenticated |

### DMS master data and inventory (`/api/dms`, admin)

Mounted with admin auth: categories, brands, suppliers, retailers, stock-in, inventory, low-stock, inventory-movements, dashboard, stock-adjustment, sales-orders, order tracking, invoices, order payment, payments.

| Method | Path |
| --- | --- |
| `GET` `POST` | `/api/dms/categories` |
| `PUT` `DELETE` | `/api/dms/categories/:id` |
| `GET` `POST` | `/api/dms/brands` |
| `PUT` `DELETE` | `/api/dms/brands/:id` |
| `GET` `POST` | `/api/dms/suppliers` |
| `PUT` `DELETE` | `/api/dms/suppliers/:id` |
| `GET` `POST` | `/api/dms/retailers` |
| `PUT` `DELETE` | `/api/dms/retailers/:id` |
| `POST` | `/api/dms/stock-in` |
| `GET` | `/api/dms/inventory` |
| `GET` | `/api/dms/inventory/low-stock` |
| `GET` | `/api/dms/inventory-movements` |
| `GET` | `/api/dms/dashboard` |
| `POST` | `/api/dms/stock-adjustment` |
| `GET` | `/api/dms/sales-orders` |
| `GET` | `/api/dms/orders/:id/tracking` |
| `GET` | `/api/dms/invoices` |
| `GET` | `/api/dms/invoices/:id` |
| `POST` | `/api/dms/orders/:id/payment` |
| `GET` | `/api/dms/payments` |

### Sales, territories, purchasing, returns

| Method | Path | Access |
| --- | --- | --- |
| `GET` `POST` | `/api/sales-representatives` | Admin |
| `PUT` `DELETE` | `/api/sales-representatives/:id` | Admin |
| `GET` `POST` | `/api/sales/targets` | Admin |
| `PUT` | `/api/sales/targets/:id` | Admin |
| `GET` | `/api/sales/performance` | Admin |
| `GET` | `/api/sales/leaderboard` | Admin |
| `GET` | `/api/sales/commissions` | Admin |
| `POST` | `/api/sales/commissions/pay` | Admin |
| `GET` `POST` | `/api/territories` | Admin |
| `PUT` `DELETE` | `/api/territories/:id` | Admin |
| `GET` | `/api/territories/performance` | Admin |
| `GET` | `/api/territories/:id/products` | Admin |
| `GET` `POST` | `/api/purchase-orders` | Admin |
| `GET` `PUT` | `/api/purchase-orders/:id` | Admin |
| `POST` | `/api/purchase-orders/:id/status` | Admin |
| `POST` | `/api/purchase-orders/:id/receive` | Admin |
| `POST` | `/api/returns` | Authenticated |
| `GET` | `/api/returns/mine` | Authenticated |
| `GET` | `/api/returns` | Admin |
| `GET` | `/api/returns/:id` | Admin |
| `PUT` | `/api/returns/:id/status` | Admin |
| `GET` | `/api/inventory/damaged` | Admin |
| `GET` | `/api/inventory/expired` | Admin |
| `GET` | `/api/inventory/expiry-alerts` | Admin |
| `GET` | `/api/inventory/expired-products` | Admin |

### Analytics, reorder, activity, search

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/analytics/overview` | Admin |
| `GET` | `/api/analytics/trend` | Admin |
| `GET` | `/api/analytics/performance` | Admin |
| `GET` | `/api/analytics/inventory` | Admin |
| `GET` | `/api/analytics/quality` | Admin |
| `PUT` | `/api/reorder/products/:id/settings` | Admin |
| `GET` | `/api/reorder/recommendations` | Admin |
| `GET` | `/api/reorder/movers` | Admin |
| `GET` | `/api/reorder/health` | Admin |
| `POST` | `/api/reorder/purchase-order` | Admin |
| `GET` | `/api/activity-logs` | Admin |
| `GET` | `/api/activity-logs/:id` | Admin |
| `GET` | `/api/global-search` | Admin |
| `GET` | `/api/documents` | Admin |

### Reports

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/reports/summary` | Admin |
| `GET` | `/api/reports/orders/pdf` | Admin |
| `GET` | `/api/reports/orders/csv` | Admin |
| `GET` | `/api/reports/products/csv` | Admin |
| `GET` | `/api/reports/advanced/sales/daily` | Admin |
| `GET` | `/api/reports/advanced/sales/weekly` | Admin |
| `GET` | `/api/reports/advanced/sales/monthly` | Admin |
| `GET` | `/api/reports/advanced/sales/by-product` | Admin |
| `GET` | `/api/reports/advanced/sales/by-customer` | Admin |
| `GET` | `/api/reports/advanced/sales/by-sales-rep` | Admin |
| `GET` | `/api/reports/advanced/sales/by-territory` | Admin |
| `GET` | `/api/reports/advanced/sales/status-report` | Admin |
| `GET` | `/api/reports/advanced/inventory/current` | Admin |
| `GET` | `/api/reports/advanced/inventory/movement` | Admin |
| `GET` | `/api/reports/advanced/inventory/dead-stock` | Admin |
| `GET` | `/api/reports/advanced/inventory/valuation` | Admin |
| `GET` | `/api/reports/advanced/purchases/summary` | Admin |
| `GET` | `/api/reports/advanced/purchases/by-supplier` | Admin |
| `GET` | `/api/reports/advanced/financial/summary` | Admin |
| `GET` | `/api/reports/advanced/financial/expenses` | Admin |
| `POST` | `/api/reports/advanced/financial/expenses` | Admin |
| `GET` | `/api/reports/advanced/export/:type` | Admin (Excel) |

### AI assistants

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/ai/query` | Admin |
| `GET` | `/api/ai/conversations` | Admin |
| `GET` | `/api/ai/conversations/:id/messages` | Admin |
| `DELETE` | `/api/ai/conversations/:id` | Admin |
| `POST` | `/api/customer-ai/query` | Customer |
| `GET` | `/api/customer-ai/conversations` | Customer |
| `GET` | `/api/customer-ai/conversations/:id/messages` | Customer |
| `DELETE` | `/api/customer-ai/conversations/:id` | Customer |

### Profit, promotions, credit

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/profit/summary` | Admin |
| `GET` | `/api/promotions/active` | Authenticated |
| `GET` `POST` | `/api/promotions` | Admin |
| `GET` `PUT` `DELETE` | `/api/promotions/:id` | Admin |
| `POST` | `/api/promotions/:id/toggle` | Admin |
| `GET` | `/api/credit/dashboard` | Admin |
| `GET` | `/api/credit/overdue` | Admin |
| `GET` | `/api/credit/retailer/:id` | Admin |
| `GET` | `/api/credit/retailer/:id/ledger` | Admin |
| `POST` | `/api/credit/retailer/:id/adjust` | Admin |
| `POST` | `/api/credit/retailer/:id/collect` | Admin |

### Deliveries, loyalty, warehouses, barcode

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/deliveries/customer/:orderId` | Authenticated (own order unless admin) |
| `GET` | `/api/deliveries/dashboard` | Admin |
| `GET` `POST` | `/api/deliveries/persons` | Admin |
| `PUT` `DELETE` | `/api/deliveries/persons/:id` | Admin |
| `GET` `POST` | `/api/deliveries` | Admin |
| `GET` | `/api/deliveries/:id` | Admin |
| `PUT` | `/api/deliveries/:id/status` | Admin |
| `GET` | `/api/loyalty/mine` | Authenticated |
| `GET` | `/api/loyalty/transactions/mine` | Authenticated |
| `POST` | `/api/loyalty/redeem/mine` | Authenticated |
| `GET` `PUT` | `/api/loyalty/config` | Admin |
| `GET` | `/api/loyalty/accounts` | Admin |
| `GET` | `/api/loyalty/account/:userId` | Admin |
| `POST` | `/api/loyalty/earn` | Admin |
| `POST` | `/api/loyalty/redeem` | Admin |
| `POST` | `/api/loyalty/adjust` | Admin |
| `GET` | `/api/loyalty/transactions` | Admin |
| `GET` | `/api/loyalty/dashboard` | Admin |
| `GET` | `/api/warehouses` | Admin |
| `GET` | `/api/warehouses/dashboard` | Admin |
| `GET` `POST` | `/api/warehouses/transfers` | Admin |
| `GET` | `/api/warehouses/transfers/:id` | Admin |
| `PUT` | `/api/warehouses/transfers/:id/status` | Admin |
| `GET` | `/api/warehouses/:id` | Admin |
| `GET` | `/api/warehouses/:id/inventory` | Admin |
| `POST` | `/api/warehouses` | Admin |
| `PUT` | `/api/warehouses/:id` | Admin |
| `POST` | `/api/warehouses/:id/inventory` | Admin |
| `DELETE` | `/api/warehouses/:id` | Admin |
| `GET` | `/api/barcode/search` | Authenticated |
| `GET` | `/api/barcode/product/:id` | Authenticated |
| `POST` | `/api/barcode/set-barcode` | Admin |

### Sales routes, visits, companies, security

| Method | Path | Access |
| --- | --- | --- |
| `GET` `POST` | `/api/sales-routes` | Admin |
| `GET` `PUT` `DELETE` | `/api/sales-routes/:id` | Admin |
| `PUT` | `/api/sales-routes/:id/reorder` | Admin |
| `GET` | `/api/sales-routes/:id/performance` | Admin |
| `GET` | `/api/visits` | Admin |
| `GET` | `/api/visits/dashboard` | Admin |
| `GET` | `/api/visits/rep/:salesRepId` | Admin |
| `POST` | `/api/visits/check-in` | Admin |
| `GET` | `/api/visits/:id` | Admin |
| `PUT` | `/api/visits/:id/check-out` | Admin |
| `PUT` | `/api/visits/:id/skip` | Admin |
| `PUT` | `/api/visits/:id/cancel` | Admin |
| `GET` `POST` | `/api/companies` | Admin |
| `GET` `PUT` `DELETE` | `/api/companies/:id` | Admin |
| `GET` | `/api/companies/:id/summary` | Admin |
| `GET` `POST` | `/api/branches` | Admin |
| `GET` `PUT` `DELETE` | `/api/branches/:id` | Admin |
| `GET` | `/api/security/events` | Admin |
| `GET` | `/api/security/dashboard` | Admin |
| `POST` | `/api/security/events` | Admin |
| `GET` | `/api/security/sessions` | Admin |
| `POST` | `/api/security/sessions/:id/revoke` | Admin |
| `POST` | `/api/security/sessions/revoke-all/:userId` | Admin |
| `GET` | `/api/security/password-changes` | Admin |
| `GET` | `/api/security/audit-log` | Admin |

---

## Authentication and security

- Passwords are stored with **bcrypt**. JWTs are signed with `JWT_SECRET` from the environment only.
- Helmet headers, a 1 MB JSON body limit, and rate limiters on auth and password-reset routes.
- CORS is an origin allow-list (`CORS_ORIGIN`). Wildcard origins are refused in production.
- SQL uses parameterised queries.
- Error responses are generic JSON (no stack traces).
- Public registration ignores a client-supplied `role`.
- Password-reset OTPs are hashed (`otp_hash`), expire in 10 minutes, are attempt‑limited, and are never returned in API JSON. OTP generation and verification are implemented, and `RESET_DEV_LOG=true` will print the OTP to the **server console** during non‑production development. Production email/SMS delivery is not implemented yet; configuring `MAIL_*` or `SMS_PROVIDER_API_KEY` does not enable delivery.
- Uploads: admin only; JPEG/PNG/WebP; MIME plus magic bytes; 5 MB; random stored filenames.
- Payment create/verify ignores client-supplied amounts; Razorpay HMAC is verified with the **server** secret.
- Assistants take identity from the JWT. Customer tools cannot query other users or admin topics.
- Logs must not include passwords, OTPs, tokens, or payment secrets.

---

## AI integration

Two UIs:

- Admin: `/admin/assistant` → `/api/ai`
- Customer: `/customer-ai` (also linked from the customer dashboard) → `/api/customer-ai`

Behaviour that is implemented **without** an LLM:

- Intent detection and a **single** authorised tool run per request
- Deterministic answers from that tool result
- Conversation history (admin list capped at 100 conversations; messages return the latest 100, oldest-first)
- Follow-ups can reuse the previous tool result (for example “how much was the second one?”)
- Missing or NULL figures are labelled, not invented
- Roles `sales_rep` and `delivery` receive no AI tools

**LLM narration is optional and disabled by default** (`LLM_ENABLED` is false in `.env.example`). When enabled with `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL`, the model may only narrate the sealed tool result. Timeouts, refusals, missing keys, or invalid output fall back to the deterministic text. The `mock` provider is for tests, not production narration.

---

## Testing instructions

Backend (from `backend/`):

```bash
npm test
```

This runs Node’s test runner on `tests/**/*.test.js` (auth compatibility, customer invoices/payments, AI/LLM behaviour, advanced report export). Tests do not require a live LLM provider.

Frontend:

```bash
cd frontend
npm test
```

That script is `node --test` only. There is **no** bundled UI test suite wired to the React pages.

---

## Current limitations

- **Not deployed.** Run it yourself; this README does not claim a live site, uptime, or user metrics.
- **No screenshots** are included in the repository.
- **`sales_rep` and `delivery` have no frontend applications.** Those enum values exist on `users`; operations UIs manage representatives and delivery persons as data, not as logged-in apps.
- **LLM is off** until you configure it. Without a key, assistants still answer from deterministic tools.
- **Password reset in production** needs a real mail or SMS provider. Locally, OTP delivery is not complete unless you set `RESET_DEV_LOG` (console only) or configure mail/SMS.
- **Vite default port is 5173**, while `backend/.env.example` still mentions `localhost:3000`. Align `CORS_ORIGIN` with the URL Vite prints.
- Frontend `.env.example` comments still mention Create React App; the bundler is **Vite**.
- **Node version is not pinned.**
- Seed SQL files are **not published** (gitignore `*.sql` except schema and migrations).
- **No Docker / Compose** files, **no CI config** in this tree, **no LICENSE file**.
- The customer AI page is not in the main sidebar; it is reached from the dashboard (and the `/customer-ai` route).
- Cart state is client-side (local storage), not a server cart API.

---

## Future improvements

These are reasonable follow-ons; they are **not** implemented:

- First-class login apps for field sales and delivery, if those roles should be used as accounts
- Docker Compose for MySQL + API + frontend
- Align example CORS/frontend ports and CRA comments with Vite
- A stated open-source license
- Broader automated tests for HTTP routes and the React UI
- Production-ready OTP email out of the box without a separate provider setup
- Server-side cart and multi-tenant hardening beyond the current company/branch columns

---

## Contributing

This project is published for review and local use. There is no contributor covenant or issue template in the repository.

If you fork it:

1. Do not commit `.env`, `.env.local`, uploads, or database dumps.
2. Keep secrets in the environment.
3. Prefer small, reviewable changes and the existing backend test command.

---

## License status

**No license has been specified.** There is no `LICENSE` file in this repository. All rights remain with the author until a license is added. Do not assume you may use this code in a product without permission.
