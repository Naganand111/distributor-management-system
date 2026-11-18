import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { getCart, setCart } from "../lib/auth";
import { formatINR, getImageSrc } from "../lib/utils";
import { openRazorpay } from "../lib/payment";

const round2 = (n) => Math.round(n * 100) / 100;

export default function Checkout() {
  const [items, setItems] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [stockOk, setStockOk] = useState(true);

  const [form, setForm] = useState({ name: "", email: "", mobile: "", address: "", city: "", state: "", pincode: "" });
  const [retailerId, setRetailerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("online");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  // Amounts are server-authoritative: this is only the pre-checkout estimate
  // shown while the customer fills the form. The order response replaces it.
  const [quote, setQuote] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    setItems(getCart() || []);
    // Load profile + retailers in parallel
    Promise.all([
      api.get("/profile").catch(() => null),
      api.get("/retailers/customer-list").catch(() => []),
    ]).then(([prof, rets]) => {
      if (prof?.data) {
        setForm({
          name: prof.data.name || "",
          email: prof.data.email || "",
          mobile: prof.data.mobile || "",
          address: prof.data.address || "",
          city: prof.data.city || "",
          state: prof.data.state || "",
          pincode: prof.data.pincode || "",
        });
        if (prof.data.retailer_id) setRetailerId(String(prof.data.retailer_id));
      }
      setRetailers(Array.isArray(rets.data) ? rets.data : []);
    });
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
  const discountVal = 0;
  const gst = round2((subtotal - discountVal) * 0.18);
  const grandTotal = quote?.grand_total ?? round2(subtotal - discountVal + gst);

  /* Re-check stock against the live product stock before placing order. */
  const validateStock = async () => {
    const results = await Promise.all(
      items.map((i) => api.get(`/products/${i.id}`).then((r) => ({ id: i.id, data: r.data.data })).catch(() => ({ id: i.id, data: null })))
    );
    for (const r of results) {
      if (!r.data || r.data.stock < (items.find((x) => x.id === r.id)?.quantity || 0)) {
        return false;
      }
    }
    return true;
  };

  const placeOrder = async () => {
    setError("");
    if (items.length === 0) {
      setError("Your cart is empty.");
      return;
    }
    if (!form.name || !form.address || !form.city || !form.state || !form.pincode) {
      setError("Please fill in your shipping details.");
      return;
    }

    setPlacing(true);
    try {
      const ok = await validateStock();
      if (!ok) {
        setError("Some items in your cart are no longer available in the requested quantity. Please review your cart.");
        setStockOk(false);
        setPlacing(false);
        return;
      }

      // Only product ids and quantities are sent. Prices, discounts, GST and
      // the total are recalculated by the server from the database.
      const payload = {
        items: items.map((i) => ({ id: i.id, quantity: i.quantity })),
        payment_method: paymentMethod === "online" ? "online" : "cash",
        retailer_id: retailerId ? Number(retailerId) : null,
        shipping: form,
      };

      const orderRes = await api.post("/orders", payload);
      const orderId = orderRes.data.orderId;
      // The payable amount always comes back from the server.
      setQuote(orderRes.data);

      if (paymentMethod === "online") {
        // No amount is sent: the server recalculates the payable total from the
        // order row and returns the gateway order it created for that amount.
        await openRazorpay({
          orderId,
          name: form.name,
          onSuccess: () => clearCart(orderId),
          onFailure: () => clearCart(orderId),
        });
      } else {
        clearCart(orderId);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to place order. Please try again.");
      setPlacing(false);
    }
  };

  const clearCart = (orderId) => {
    setCart([]);
    window.dispatchEvent(new Event("cartUpdated"));
    navigate(`/order-success/${orderId}`);
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-5">
        <div style={{ fontSize: 60 }}>🛒</div>
        <h4 className="mt-3">Your cart is empty</h4>
        <Link to="/shop" className="btn btn-primary customer-btn mt-2">Continue Shopping</Link>
      </div>
    );
  }

  return (
    <div>
      <nav className="mb-3"><Link to="/cart" className="text-decoration-none">← Back to Cart</Link></nav>
      <h3 className="cust-page-title mb-1">Checkout</h3>
      <p className="text-muted mb-4">Complete your order details below</p>

      {error && <div className="alert alert-danger">{error}</div>}
      {!stockOk && (
        <div className="alert alert-warning">Stock has changed for some items. Please review your cart.</div>
      )}

      <div className="row g-4">
        <div className="col-lg-7">
          {/* SHIPPING */}
          <div className="card shadow-sm cust-card mb-4">
            <div className="card-header cust-card-header">Shipping / Delivery Information</div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Full Name *</label>
                  <input className="form-control" value={form.name} onChange={set("name")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Email</label>
                  <input className="form-control" type="email" value={form.email} onChange={set("email")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Mobile *</label>
                  <input className="form-control" value={form.mobile} onChange={set("mobile")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Pincode *</label>
                  <input className="form-control" value={form.pincode} onChange={set("pincode")} />
                </div>
                <div className="col-12">
                  <label className="form-label">Address *</label>
                  <input className="form-control" value={form.address} onChange={set("address")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">City *</label>
                  <input className="form-control" value={form.city} onChange={set("city")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">State *</label>
                  <input className="form-control" value={form.state} onChange={set("state")} />
                </div>
              </div>
            </div>
          </div>

          {/* RETAILER + PAYMENT */}
          <div className="card shadow-sm cust-card mb-4">
            <div className="card-header cust-card-header">Order Options</div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Retailer (optional)</label>
                  <select className="form-select" value={retailerId} onChange={(e) => setRetailerId(e.target.value)}>
                    <option value="">Select a retailer (optional)</option>
                    {retailers.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}{r.shop_name ? ` (${r.shop_name})` : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label">Payment Method *</label>
                  <div className="d-flex gap-3">
                    <div className="form-check">
                      <input className="form-check-input" type="radio" name="pm" id="pm-online" checked={paymentMethod === "online"} onChange={() => setPaymentMethod("online")} />
                      <label className="form-check-label" htmlFor="pm-online">💳 Online Payment</label>
                    </div>
                    <div className="form-check">
                      <input className="form-check-input" type="radio" name="pm" id="pm-cod" checked={paymentMethod === "cash"} onChange={() => setPaymentMethod("cash")} />
                      <label className="form-check-label" htmlFor="pm-cod">💵 Cash on Delivery</label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SUMMARY */}
        <div className="col-lg-5">
          <div className="card shadow-sm cust-card">
            <div className="card-header cust-card-header">Order Summary</div>
            <div className="card-body">
              <div className="mb-3">
                {items.map((i) => (
                  <div key={i.id} className="d-flex align-items-center gap-2 mb-2">
                    <img src={getImageSrc(i.image)} alt={i.name} className="rounded" style={{ width: 42, height: 42, objectFit: "cover" }} onError={(e) => (e.target.src = "/no-image.png")} />
                    <div className="flex-grow-1">
                      <div className="small fw-semibold">{i.name}</div>
                      <div className="text-muted small">Qty: {i.quantity} × {formatINR(i.price)}</div>
                    </div>
                    <div className="small">{formatINR(Number(i.price) * Number(i.quantity))}</div>
                  </div>
                ))}
              </div>
              <hr />
              <div className="d-flex justify-content-between mb-1"><span>Subtotal</span><span>{formatINR(quote?.subtotal ?? subtotal)}</span></div>
              {(quote?.discount ?? discountVal) > 0 && (
                <div className="d-flex justify-content-between mb-1"><span>Discount</span><span className="text-danger">− {formatINR(quote?.discount ?? discountVal)}</span></div>
              )}
              <div className="d-flex justify-content-between mb-1"><span>GST ({Math.round((quote?.gst_rate ?? 0.18) * 100)}%)</span><span>{formatINR(quote?.gst ?? gst)}</span></div>
              <hr />
              <div className="d-flex justify-content-between fw-bold fs-5"><span>Grand Total</span><span>{formatINR(grandTotal)}</span></div>

              <button className="btn btn-primary w-100 mt-3 customer-btn" onClick={placeOrder} disabled={placing}>
                {placing ? "Placing order…" : paymentMethod === "online" ? "Proceed to Pay" : "Place Order (COD)"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`.customer-btn { border-radius:999px; }`}</style>
    </div>
  );
}
