import mysql from "mysql2/promise";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Required environment variable ${name} is not set. Check backend/.env`);
  }
  return value;
}

const host = requireEnv("DB_HOST");
const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;
const user = requireEnv("DB_USER");
const password = process.env.DB_PASSWORD ?? "";
const database = requireEnv("DB_NAME");

const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,
});

export default pool;