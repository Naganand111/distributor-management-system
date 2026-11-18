/**
 * Phase 9 Step 4 (M2): the selected authorized tool must run exactly once per
 * request. The route executes it, seals the result with a module-private brand,
 * and the orchestrator narrates from that value instead of calling
 * registry.execute() a second time.
 *
 * A sealed result cannot be forged from an HTTP body (JSON has no symbols), and
 * a missing / unsealed / mismatched value simply keeps the original re-execute
 * path, so disabled-LLM, fallback, authorization and multi-tool behaviour stay
 * unchanged.
 *
 *   U1  sealed precomputed data is narrated and the tool is NOT re-executed
 *   U2  missing precomputed data keeps the original registry execution
 *   U3  unsealed / wrong-tool data is ignored (brand cannot be forged)
 *   U4  expectedTool restrictions are still enforced
 *   U5  a wrong-role actor is still refused before any tool call
 *   U6  provider failure degrades to the deterministic decision
 *   U7  LLM-disabled behaviour is unchanged
 *   R1  Admin route: tool runs exactly once with LLM narration on
 *   R2  Customer route: tool runs exactly once with LLM narration on
 *   R3  provider failure keeps the deterministic Admin answer
 *   R4  LLM disabled keeps the deterministic Admin answer
 *
 * Run: node --test tests/ai.single-execution.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import registerAi from "../routes/ai.js";
import registerCustomerAi from "../routes/customerAi.js";
import {
  LLM_ERROR_CODES,
  clearLlmMemory,
  createLlmService,
  createMockProvider,
} from "../services/llm/index.js";
import {
  answerWithLlm,
  sealPrecomputedToolResult,
} from "../services/ai/orchestrator.js";

/* Deterministic answers are asserted, so pin the LLM off by default. */
process.env.LLM_ENABLED = "false";

/* Routes read req.user.id; the orchestrator reads actor.userId. Both are set
   so the same fixture works for unit-level and route-level tests. */
const ADMIN = { id: 7, userId: 7, role: "admin" };
const CUSTOMER = { id: 42, userId: 42, role: "customer" };
const REVENUE_ROWS = [{ orders: 11, revenue: 987654.32 }];
const ORDER_ROWS = [
  { id: 301, status: "delivered", payment_status: "paid", total_amount: 1500, discount: 0, created_at: "2026-10-01", item_count: 2, invoice_no: null },
];
const KITCHEN = [{ orders: 6, revenue: 9000, count: 6, customers: 2 }];

/* ------------------------------------------------------------------ *
 * Unit helpers
 * ------------------------------------------------------------------ */

/** Recording pool: refuses writes and captures every statement. */
function recordingPool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      if (/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)/i.test(String(sql).trim())) {
        throw new Error("recording pool received a write statement");
      }
      calls.push({ sql: String(sql), params: params || [] });
      return [rows, []];
    },
  };
}

function serviceWith(provider, env = {}) {
  return createLlmService({
    env: {
      LLM_ENABLED: "true",
      LLM_PROVIDER: "mock",
      LLM_MODEL: "mock-deterministic",
      LLM_MAX_TOOL_ITERATIONS: "5",
      LLM_TIMEOUT_MS: "20000",
      ...env,
    },
    provider,
  });
}

/** Mock provider whose plan turn selects exactly `toolName`. */
function planFor(toolName) {
  return createMockProvider({
    responses: [{ kind: "tool_calls", toolCalls: [{ name: toolName, args: {} }] }],
  });
}

const narrateRequest = (provider) =>
  provider.requests.find((r) => r.purpose === "narrate");

/* ------------------------------------------------------------------ *
 * In-memory conversation pool for route-level tests
 * ------------------------------------------------------------------ */

function conversationPool(responder = () => KITCHEN) {
  const state = { conversations: [], messages: [], nextConv: 900 };
  const calls = [];

  return {
    state,
    calls,
    businessCalls: () => calls.filter((c) => !/ai_conversations|ai_messages/.test(c.sql)),
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });

      if (/SELECT id FROM ai_conversations WHERE id=\? AND user_id=\?/.test(text)) {
        const [id, userId] = params;
        const owned = state.conversations.some(
          (c) => c.id === Number(id) && c.userId === Number(userId)
        );
        return [owned ? [{ id: Number(id) }] : [], []];
      }
      if (/INSERT INTO ai_conversations/.test(text)) {
        const conv = { id: ++state.nextConv, userId: Number(params[0]) };
        state.conversations.push(conv);
        return [{ insertId: conv.id, affectedRows: 1 }, []];
      }
      if (/INSERT INTO ai_messages/.test(text)) {
        const convId = Number(params[0]);
        const role = /'user'/.test(text) ? "user" : "assistant";
        state.messages.push({ convId, role, content: params[1], meta: params[2] });
        return [{ insertId: state.messages.length, affectedRows: 1 }, []];
      }
      if (/FROM ai_messages/.test(text)) {
        const convId = Number(params[0]);
        const owner = state.conversations.find((c) => c.id === convId);
        const userId = params.length > 1 ? Number(params[1]) : null;
        const scoped = owner && (userId === null || owner.userId === userId);
        const rows = scoped
          ? state.messages
              .filter((m) => m.convId === convId)
              .map((m) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta, created_at: new Date() }))
          : [];
        return [rows, []];
      }
      if (/UPDATE ai_conversations/.test(text)) {
        return [{ affectedRows: 1 }, []];
      }
      return [responder(text, params) || [], []];
    },
  };
}

const adminResponder = (sql) => {
  if (/FROM orders\b/.test(sql)) return REVENUE_ROWS;
  return KITCHEN;
};
const customerResponder = (sql) => {
  if (/FROM orders\b/.test(sql)) return ORDER_ROWS;
  return KITCHEN;
};

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function mountAdmin(pool, user = ADMIN) {
  const app = express();
  app.use(express.json());
  registerAi(
    app,
    pool,
    (req, _res, next) => { req.user = user; next(); },
    (_q, _res, next) => next()
  );
  return listen(app);
}

async function mountCustomer(pool, user = CUSTOMER) {
  const app = express();
  app.use(express.json());
  registerCustomerAi(app, pool, (req, _res, next) => { req.user = user; next(); });
  return listen(app);
}

const ask = (base, path, message) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((r) => r.json());

const askAdmin = (base, message) => ask(base, "/api/ai/query", message);
const askCustomer = (base, message) => ask(base, "/api/customer-ai/query", message);

/* Save/restore the LLM environment for the route tests. */
const LLM_KEYS = ["LLM_ENABLED", "LLM_PROVIDER", "LLM_MODEL"];
function setEnv(values) {
  const saved = {};
  for (const key of LLM_KEYS) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const key of LLM_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

/* ================================================================ *
 * Unit-level: answerWithLlm with an injected provider and recording db
 * ================================================================ */

test("U1 sealed precomputed data is narrated and the tool is NOT re-executed", async () => {
  clearLlmMemory();
  const provider = planFor("get_total_revenue");
  const db = recordingPool(REVENUE_ROWS);
  const sealed = sealPrecomputedToolResult("get_total_revenue", {
    orders: 42,
    revenue: 123,
    marker: "SEED-42",
  });

  const decision = await answerWithLlm({
    actor: ADMIN,
    message: "what is the total revenue",
    db,
    service: serviceWith(provider),
    surface: "admin",
    deterministicIntent: "total_revenue",
    precomputedResult: sealed,
  });

  assert.equal(decision.ok, true, "the model narrated successfully");
  assert.equal(decision.reason, null);
  assert.equal(db.calls.length, 0, "registry.execute() did not run a second time");
  const narration = narrateRequest(provider);
  assert.ok(narration, "a narration turn happened");
  assert.ok(
    JSON.stringify(narration.messages).includes("SEED-42"),
    "the precomputed payload — not a fresh tool result — reached narration"
  );
});

test("U2 missing precomputed data keeps the original registry execution", async () => {
  clearLlmMemory();
  const provider = planFor("get_total_revenue");
  const db = recordingPool(REVENUE_ROWS);

  const decision = await answerWithLlm({
    actor: ADMIN,
    message: "what is the total revenue",
    db,
    service: serviceWith(provider),
    surface: "admin",
    deterministicIntent: "total_revenue",
  });

  assert.equal(decision.ok, true);
  assert.equal(db.calls.length, 1, "the tool executed exactly once via the registry");
  assert.ok(narrateRequest(provider), "the executed data was narrated");
});

test("U3 unsealed or wrong-tool precomputed data is ignored (brand cannot be forged)", async () => {
  clearLlmMemory();

  /* A plain object resembling a sealed result (as an HTTP body could produce)
     has no private symbol, so it must be rejected. */
  const providerA = planFor("get_total_revenue");
  const dbA = recordingPool(REVENUE_ROWS);
  const decisionA = await answerWithLlm({
    actor: ADMIN,
    message: "what is the total revenue",
    db: dbA,
    service: serviceWith(providerA),
    deterministicIntent: "total_revenue",
    precomputedResult: { toolName: "get_total_revenue", data: { marker: "FORGED" } },
  });
  assert.equal(decisionA.ok, true);
  assert.equal(dbA.calls.length, 1, "unsealed data was ignored; the tool ran normally");
  assert.ok(
    !JSON.stringify(narrateRequest(providerA).messages).includes("FORGED"),
    "forged data never reached the model"
  );

  /* A genuinely sealed value for a different tool must not be reused either. */
  const providerB = planFor("get_total_revenue");
  const dbB = recordingPool(REVENUE_ROWS);
  const decisionB = await answerWithLlm({
    actor: ADMIN,
    message: "what is the total revenue",
    db: dbB,
    service: serviceWith(providerB),
    deterministicIntent: "total_revenue",
    precomputedResult: sealPrecomputedToolResult("get_business_summary", { marker: "WRONG-TOOL" }),
  });
  assert.equal(decisionB.ok, true);
  assert.equal(dbB.calls.length, 1, "a mismatched tool seal was ignored");
  assert.ok(
    !JSON.stringify(narrateRequest(providerB).messages).includes("WRONG-TOOL"),
    "mismatched data never reached the model"
  );
});

test("U4 expectedTool restrictions are still enforced", async () => {
  clearLlmMemory();
  const provider = createMockProvider({
    responses: [{ kind: "tool_calls", toolCalls: [{ name: "get_business_summary", args: {} }] }],
  });
  const db = recordingPool(REVENUE_ROWS);

  const decision = await answerWithLlm({
    actor: ADMIN,
    message: "what is the total revenue",
    db,
    service: serviceWith(provider),
    deterministicIntent: "total_revenue",
    precomputedResult: sealPrecomputedToolResult("get_total_revenue", { orders: 1 }),
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, LLM_ERROR_CODES.INVALID_TOOL_SELECTION);
  assert.equal(db.calls.length, 0, "the wrong tool never executes");
  assert.equal(provider.requests.length, 1, "no narration turn for a wrong selection");
});

test("U5 a wrong-role actor is still refused before any tool call", async () => {
  clearLlmMemory();
  const provider = planFor("get_total_revenue");
  const db = recordingPool(REVENUE_ROWS);

  const decision = await answerWithLlm({
    actor: CUSTOMER,
    message: "what is the total revenue",
    db,
    service: serviceWith(provider),
    deterministicIntent: "total_revenue",
    precomputedResult: sealPrecomputedToolResult("get_total_revenue", { orders: 1 }),
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, LLM_ERROR_CODES.TOOL_REFUSED);
  assert.equal(db.calls.length, 0, "no tool runs for a role that may not use it");
  assert.equal(provider.requests.length, 0, "no provider call is spent on a refusal");
});

test("U6 provider failure degrades to the deterministic decision", async () => {
  clearLlmMemory();
  const provider = createMockProvider({
    responses: [{ kind: "error", code: LLM_ERROR_CODES.PROVIDER_ERROR }],
  });
  const db = recordingPool(REVENUE_ROWS);

  const decision = await answerWithLlm({
    actor: ADMIN,
    message: "what is the total revenue",
    db,
    service: serviceWith(provider),
    deterministicIntent: "total_revenue",
    precomputedResult: sealPrecomputedToolResult("get_total_revenue", { orders: 1 }),
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, LLM_ERROR_CODES.PROVIDER_ERROR);
  assert.equal(decision.text, null, "no model text is returned on failure");
  assert.equal(db.calls.length, 0);
});

test("U7 LLM-disabled behaviour is unchanged", async () => {
  clearLlmMemory();
  const provider = planFor("get_total_revenue");
  const db = recordingPool(REVENUE_ROWS);

  const decision = await answerWithLlm({
    actor: ADMIN,
    message: "what is the total revenue",
    db,
    service: serviceWith(provider, { LLM_ENABLED: "false" }),
    deterministicIntent: "total_revenue",
    precomputedResult: sealPrecomputedToolResult("get_total_revenue", { orders: 1 }),
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, LLM_ERROR_CODES.DISABLED);
  assert.equal(db.calls.length, 0);
  assert.equal(provider.requests.length, 0);
});

/* ================================================================ *
 * Route-level: real routers, env-driven mock provider
 * ================================================================ */

test("R1 Admin route executes the tool exactly once with LLM narration on", async () => {
  const restore = setEnv({ LLM_ENABLED: "true", LLM_PROVIDER: "mock", LLM_MODEL: "mock-deterministic" });
  clearLlmMemory();
  const pool = conversationPool(adminResponder);
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base, "what is the total revenue");
    assert.equal(response.data.intent, "total_revenue");
    assert.ok(
      response.data.answer.includes("The tool returned"),
      "the LLM narrated from the precomputed result"
    );
    assert.equal(
      pool.businessCalls().length,
      1,
      "the authorized tool ran once — not once in the route and again in the orchestrator"
    );
  } finally {
    await close();
    restore();
    clearLlmMemory();
  }
});

test("R2 Customer route executes the tool exactly once with LLM narration on", async () => {
  const restore = setEnv({ LLM_ENABLED: "true", LLM_PROVIDER: "mock", LLM_MODEL: "mock-deterministic" });
  clearLlmMemory();
  const pool = conversationPool(customerResponder);
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my orders");
    assert.equal(response.data.intent, "my_orders");
    assert.ok(
      response.data.answer.includes("The tool returned"),
      "the LLM narrated from the customer's own scoped result"
    );
    assert.equal(
      pool.businessCalls().length,
      1,
      "the customer tool ran once for this actor"
    );
  } finally {
    await close();
    restore();
    clearLlmMemory();
  }
});

test("R3 provider failure keeps the deterministic Admin answer", async () => {
  const restore = setEnv({ LLM_ENABLED: "true", LLM_PROVIDER: "not-a-provider", LLM_MODEL: "x" });
  clearLlmMemory();
  const pool = conversationPool(adminResponder);
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base, "what is the total revenue");
    assert.ok(
      response.data.answer.includes("Your total recorded revenue is"),
      "the deterministic narration is preserved"
    );
    assert.ok(!response.data.answer.includes("The tool returned"), "no LLM text was used");
    assert.equal(pool.businessCalls().length, 1, "the tool still ran once");
  } finally {
    await close();
    restore();
    clearLlmMemory();
  }
});

test("R4 LLM disabled keeps the deterministic Admin answer and single execution", async () => {
  const restore = setEnv({ LLM_ENABLED: "false", LLM_PROVIDER: "mock", LLM_MODEL: "mock-deterministic" });
  clearLlmMemory();
  const pool = conversationPool(adminResponder);
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base, "what is the total revenue");
    assert.ok(response.data.answer.includes("Your total recorded revenue is"));
    assert.ok(!response.data.answer.includes("The tool returned"));
    assert.equal(pool.businessCalls().length, 1, "the tool ran once; the orchestrator was skipped");
  } finally {
    await close();
    restore();
    clearLlmMemory();
  }
});
