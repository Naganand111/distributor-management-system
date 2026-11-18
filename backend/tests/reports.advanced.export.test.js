import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { inflateRawSync } from "node:zlib";
import registerAdvancedReportRoutes from "../routes/advancedReports.js";

// Synthetic fixtures only. No MySQL connection, real user records, or env values.
const FIXED_DATE = new Date(2024, 0, 2, 3, 4, 5);
const FIXED_DATE_2 = new Date(2024, 11, 31, 23, 59, 59);

const EXPORT_HEADERS = {
  sales: ["id", "created_at", "total_amount", "status", "payment_status", "customer_name"],
  inventory: ["id", "name", "sku", "stock", "purchase_price", "mrp", "price"],
  purchases: ["id", "created_at", "total_amount", "status", "supplier_name"],
  customers: ["id", "name", "email", "phone", "created_at"],
  products: ["id", "name", "sku", "price", "mrp", "stock", "status"],
};

const EXPORT_ROWS = {
  sales: [
    {
      id: 1,
      created_at: FIXED_DATE,
      total_amount: 1234.5,
      status: "paid",
      payment_status: "",
      customer_name: null,
    },
  ],
  inventory: [
    {
      id: 2,
      name: "Widget",
      sku: "",
      stock: 12,
      purchase_price: 99.99,
      mrp: null,
      price: 149.5,
    },
  ],
  purchases: [
    {
      id: 3,
      created_at: FIXED_DATE_2,
      total_amount: 0.1,
      status: "received",
      supplier_name: null,
    },
  ],
  customers: [
    {
      id: 4,
      name: "Ada",
      email: "ada@example.test",
      phone: "",
      created_at: FIXED_DATE,
    },
  ],
  products: [
    {
      id: 5,
      name: "Gadget",
      sku: "GAD-1",
      price: 10.25,
      mrp: null,
      stock: 0,
      status: "active",
    },
  ],
};

// Mirrors SheetJS datenum(): a local 1899-12-30 base date plus the integer
// minute timezone offsets used by SheetJS. This records the exact old serial
// without importing the vulnerable library into the regression tests.
function legacyExcelSerial(date) {
  const base = new Date(1899, 11, 30, 0, 0, 0);
  const threshold =
    base.getTime() + (date.getTimezoneOffset() - base.getTimezoneOffset()) * 60000;
  return (date.getTime() - threshold) / 86400000;
}

function mockPool(responder) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const result = responder(sql, params);
      if (result instanceof Error) throw result;
      return [result];
    },
  };
}

function allowAdmin(req, _res, next) {
  req.user = { id: 1, role: "admin" };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access only" });
  next();
}

async function withServer(t, pool, authRequired = allowAdmin, adminOnly = requireAdmin) {
  const app = express();
  registerAdvancedReportRoutes(app, pool, authRequired, adminOnly);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  );
  return `http://127.0.0.1:${port}`;
}

async function get(base, path, headers = {}) {
  const response = await fetch(`${base}${path}`, { headers });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType,
    contentDisposition: response.headers.get("content-disposition"),
    body,
  };
}

function findSignature(buf, signature, fromEnd = false) {
  if (fromEnd) {
    for (let i = buf.length - 4; i >= 0; i -= 1) {
      if (buf.readUInt32LE(i) === signature) return i;
    }
  } else {
    for (let i = 0; i <= buf.length - 4; i += 1) {
      if (buf.readUInt32LE(i) === signature) return i;
    }
  }
  return -1;
}

// Minimal ZIP reader for XLSX inspection. It uses only Node built-ins and
// compares workbook structure/cells, never raw ZIP bytes.
function unzip(buf) {
  const eocd = findSignature(buf, 0x06054b50, true);
  assert.notEqual(eocd, -1, "response must be a ZIP-based XLSX file");
  const count = buf.readUInt16LE(eocd + 10);
  const centralOffset = buf.readUInt32LE(eocd + 16);

  const files = new Map();
  let offset = centralOffset;
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(offset), 0x02014b50, "invalid central directory entry");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const filenameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const filename = buf.toString("utf8", offset + 46, offset + 46 + filenameLength);

    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, "invalid local file header");
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const content =
      method === 8
        ? inflateRawSync(compressed)
        : method === 0
          ? Buffer.from(compressed)
          : null;
    assert.ok(content, `unsupported ZIP compression method ${method}`);
    files.set(filename, content.toString("utf8"));

    offset += 46 + filenameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function tagContents(xml, tag) {
  const matches = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))];
  return matches.map((m) => m[1]);
}

function parseSharedStrings(xml = "") {
  return tagContents(xml, "si").map((si) =>
    tagContents(si, "t")
      .map((t) => decodeXml(t))
      .join("")
  );
}

function parseNumberFormats(xml = "") {
  const formats = new Map([[14, "m/d/yy"]]);
  for (const m of xml.matchAll(
    /<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"[^>]*\/?>/gi
  )) {
    formats.set(Number(m[1]), decodeXml(m[2]));
  }

  const xfFormats = [];
  const cellXfs = tagContents(xml, "cellXfs")[0] || "";
  for (const m of cellXfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/gi)) {
    const formatId = /\bnumFmtId="(\d+)"/.exec(m[1])?.[1];
    xfFormats.push(
      formatId === undefined
        ? "General"
        : formats.get(Number(formatId)) || `numFmtId:${formatId}`
    );
  }
  return xfFormats;
}

function parseSheet(xml = "", sharedStrings = []) {
  const rows = new Map();
  let cellCount = 0;

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowNumber = Number(/r="(\d+)"/.exec(rowMatch[1])?.[1]);
    const cells = new Map();
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] || "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const column = /^[A-Z]+/.exec(ref)[0];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const style = /\bs="(\d+)"/.exec(attrs)?.[1];
      const rawValue = tagContents(inner, "v")[0];
      let value;

      if (type === "s") {
        value = sharedStrings[Number(rawValue)];
      } else if (type === "inlineStr") {
        value = tagContents(inner, "t").map((t) => decodeXml(t)).join("");
      } else if (type === "str") {
        value = decodeXml(rawValue);
      } else if (type === "b") {
        value = rawValue === "1";
      } else if (rawValue === undefined || rawValue === "") {
        value = "";
      } else {
        value = Number(rawValue);
      }

      cells.set(column, { value, type: type || "n", style: style === undefined ? null : Number(style) });
      cellCount += 1;
    }
    rows.set(rowNumber, cells);
  }
  return { rows, cellCount };
}

function parseWorkbook(buffer) {
  const files = unzip(buffer);
  const workbookXml = files.get("xl/workbook.xml") || "";
  const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/gi)].map((m) =>
    decodeXml(m[1])
  );
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml"));
  const dateFormats = parseNumberFormats(files.get("xl/styles.xml"));
  const sheet = parseSheet(files.get("xl/worksheets/sheet1.xml") || "", sharedStrings);
  return { sheetNames, rows: sheet.rows, cellCount: sheet.cellCount, dateFormats };
}

function cellAt(workbook, rowNumber, column) {
  return workbook.rows.get(rowNumber)?.get(column) || null;
}

function columnLetters(headers) {
  return headers.map((_, index) => String.fromCharCode(65 + index));
}

test("all five export types preserve headers, values, sheet name, MIME type and filename", async (t) => {
  for (const type of Object.keys(EXPORT_HEADERS)) {
    await t.test(type, async (subtest) => {
      const pool = mockPool(() => EXPORT_ROWS[type]);
      const base = await withServer(subtest, pool);
      const response = await get(base, `/api/reports/advanced/export/${type}`);

      assert.equal(response.status, 200);
      assert.equal(
        response.contentType,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      assert.equal(response.contentDisposition, `attachment; filename=${type}_report.xlsx`);

      const workbook = parseWorkbook(response.body);
      assert.deepEqual(workbook.sheetNames, ["Sheet1"]);

      const headers = EXPORT_HEADERS[type];
      const letters = columnLetters(headers);
      const headerRow = workbook.rows.get(1);
      assert.ok(headerRow, "header row must exist for non-empty results");
      assert.deepEqual(
        letters.map((letter) => cellAt(workbook, 1, letter)?.value),
        headers
      );

      const expected = EXPORT_ROWS[type][0];
      const actual = letters.map((letter) => cellAt(workbook, 2, letter));
      headers.forEach((header, index) => {
        const expectedValue = expected[header];
        const cell = actual[index];

        if (expectedValue === null) {
          assert.equal(cell, null, `${header} null values must remain omitted cells`);
          return;
        }

        assert.ok(cell, `cell ${letters[index]}2 must exist for value comparison`);

        if (expectedValue instanceof Date) {
          assert.equal(typeof cell.value, "number", `${header} must be a numeric Excel date serial`);
          assert.ok(
            Math.abs(cell.value - legacyExcelSerial(expectedValue)) < 0.000001,
            `${header} serial must preserve the existing date semantics`
          );
          if (cell.style !== null) {
            const format = workbook.dateFormats[cell.style];
            assert.ok(
              format === "m/d/yy" || format === "mm/dd/yy",
              `date format must be the closest equivalent, got ${format}`
            );
          }
          return;
        }

        if (typeof expectedValue === "number") {
          assert.ok(
            Math.abs(cell.value - expectedValue) < 0.0000001,
            `${header} numeric value must be preserved`
          );
          return;
        }

        assert.equal(cell.value, expectedValue, `${header} string value must be preserved`);
      });
    });
  }
});

test("empty result keeps the existing empty-sheet behavior with no header row", async (t) => {
  const pool = mockPool(() => []);
  const base = await withServer(t, pool);
  const response = await get(base, "/api/reports/advanced/export/sales");

  assert.equal(response.status, 200);
  assert.equal(
    response.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  const workbook = parseWorkbook(response.body);
  assert.deepEqual(workbook.sheetNames, ["Sheet1"]);
  assert.equal(workbook.cellCount, 0, "empty results must not add a header row");
  assert.equal(workbook.rows.size, 0, "empty results must not add rows");
});

test("date filters are applied only when both from and to are provided", async (t) => {
  for (const query of ["", "?from=2024-01-01", "?to=2024-01-31"]) {
    const pool = mockPool(() => EXPORT_ROWS.sales);
    const base = await withServer(t, pool);
    const response = await get(base, `/api/reports/advanced/export/sales${query}`);
    assert.equal(response.status, 200);
    assert.deepEqual(pool.calls[0].params, []);
    assert.ok(!pool.calls[0].sql.includes("BETWEEN"));
  }

  const pool = mockPool(() => EXPORT_ROWS.sales);
  const base = await withServer(t, pool);
  const response = await get(
    base,
    "/api/reports/advanced/export/sales?from=2024-01-01&to=2024-01-31"
  );
  assert.equal(response.status, 200);
  assert.deepEqual(pool.calls[0].params, ["2024-01-01", "2024-01-31"]);
  assert.ok(pool.calls[0].sql.includes("created_at BETWEEN ? AND ?"));
});

test("invalid export type returns the existing 400 error body", async (t) => {
  const pool = mockPool(() => []);
  const base = await withServer(t, pool);
  const response = await get(base, "/api/reports/advanced/export/unknown");

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "Invalid export type" });
  assert.equal(pool.calls.length, 0, "invalid types must not query the database");
});

test("export failures return the existing 500 error body without download headers", async (t) => {
  const pool = mockPool(() => new Error("synthetic failure"));
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  t.after(() => {
    console.error = originalError;
  });

  const base = await withServer(t, pool);
  const response = await get(base, "/api/reports/advanced/export/sales");

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Failed to export" });
  assert.ok(!response.contentType.includes("spreadsheetml"));
  assert.equal(response.contentDisposition, null);
  assert.ok(logs.some((args) => String(args[0]).includes("Export error")));
});

test("authorization and admin-only restrictions remain unchanged", async (t) => {
  const pool = mockPool(() => EXPORT_ROWS.sales);

  const noAuth = (req, res) => res.status(401).json({ error: "Authentication required" });
  const noAuthBase = await withServer(t, pool, noAuth, requireAdmin);
  const noAuthResponse = await get(noAuthBase, "/api/reports/advanced/export/sales");
  assert.equal(noAuthResponse.status, 401);
  assert.deepEqual(noAuthResponse.body, { error: "Authentication required" });

  const customerAuth = (req, _res, next) => {
    req.user = { id: 1, role: "customer" };
    next();
  };
  const customerBase = await withServer(t, pool, customerAuth, requireAdmin);
  const customerResponse = await get(customerBase, "/api/reports/advanced/export/sales");
  assert.equal(customerResponse.status, 403);
  assert.deepEqual(customerResponse.body, { error: "Admin access only" });

  const adminResponse = await get(
    await withServer(t, pool, allowAdmin, requireAdmin),
    "/api/reports/advanced/export/sales"
  );
  assert.equal(adminResponse.status, 200);
});
