/* =====================================================
   PAYMENT GATEWAY (Razorpay) — server-side only
   =====================================================

   Responsibilities:

     1. Creating the gateway order for a LOCAL order. The amount is always
        supplied by the caller from the server-calculated order total; nothing
        here ever reads a client-supplied amount.
     2. Fetching a gateway payment so the captured amount, currency, order
        binding and capture state can be confirmed with Razorpay itself instead
        of being taken on trust from the browser.
     3. Verifying the Razorpay checkout signature with a timing-safe compare.

   The key secret is read from the environment and never leaves this module:
   it is not returned by any function, not logged, and not sent to the client.

   Gateway calls fail CLOSED. If Razorpay cannot confirm a payment, the caller
   must refuse to mark an order paid — a signature alone proves only that
   Razorpay signed two ids, not that the customer paid the order's amount.
*/

import Razorpay from "razorpay";
import crypto from "node:crypto";

/** Gateway payment/order ids Razorpay issues: alphanumerics and underscores. */
const GATEWAY_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

export function isValidGatewayId(value) {
  return typeof value === "string" && GATEWAY_ID_PATTERN.test(value);
}

/**
 * Razorpay checkout signature = HMAC-SHA256(key_secret, "order_id|payment_id").
 * Compared with `timingSafeEqual` and only after a length check, so the
 * comparison itself cannot leak information through response timing.
 */
export function verifyGatewaySignature(secret, gatewayOrderId, gatewayPaymentId, signature) {
  if (!secret || typeof signature !== "string" || signature.length === 0) return false;

  const expected = createHmacSha256(secret, `${gatewayOrderId}|${gatewayPaymentId}`);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");

  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function createHmacSha256(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Rupees -> paise, the unit Razorpay uses. Rejects anything not exactly representable. */
export function rupeesToPaise(rupees) {
  const paise = Math.round(Number(rupees) * 100);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

/** Paise -> rupees. */
export function paiseToRupees(paise) {
  return Math.round(Number(paise)) / 100;
}

/**
 * A gateway error safe to log: type, HTTP status and Razorpay's own short
 * description. The SDK error object can carry the request it made, so it is
 * never logged verbatim and never returned to the client.
 */
export function safeGatewayError(err) {
  return {
    name: err?.name || "Error",
    message: String(err?.message || "gateway error").slice(0, 200),
    status: Number(err?.statusCode || err?.status || 0) || null,
    description: err?.description ? String(err.description).slice(0, 200) : null,
  };
}

/**
 * The real Razorpay client, built from the existing installed SDK.
 * Returns null when credentials are absent so callers can answer 503.
 */
export function createRazorpayGateway() {
  const key_id = process.env.RAZORPAY_KEY_ID || "";
  const key_secret = process.env.RAZORPAY_KEY_SECRET || "";

  if (!key_id || !key_secret) return null;

  const client = new Razorpay({ key_id, key_secret });

  return {
    name: "razorpay",

    async createOrder({ amountPaise, currency = "INR", receipt, notes }) {
      return client.orders.create({ amount: amountPaise, currency, receipt, notes });
    },

    async fetchPayment(paymentId) {
      return client.payments.fetch(paymentId);
    },
  };
}

/**
 * Resolve the gateway actually used by the routes.
 *
 * The test seam exists so the payment integrity suite can exercise the full
 * success path (amount binding, idempotency, concurrency) without creating
 * real orders or real captures on a live merchant account. It is inert unless
 * BOTH conditions hold: an explicit opt-in environment variable, and a
 * non-production NODE_ENV. The injected object must implement `createOrder`
 * and `fetchPayment`; it never receives the key secret.
 */
export function resolveGateway() {
  const testSeamEnabled =
    process.env.OMS_TEST_GATEWAY === "1" && process.env.NODE_ENV !== "production";

  if (testSeamEnabled && globalThis.__OMS_TEST_GATEWAY__) {
    return { ...globalThis.__OMS_TEST_GATEWAY__, testDouble: true };
  }

  return createRazorpayGateway();
}