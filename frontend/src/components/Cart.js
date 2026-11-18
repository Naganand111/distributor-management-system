import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCart, setCart } from "../lib/auth";
import { formatINR, getImageSrc } from "../lib/utils";

export default function Cart() {
  const [items, setItems] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    setItems(getCart() || []);
  }, []);

  const persist = (updated) => {
    setItems(updated);
    setCart(updated);
    window.dispatchEvent(new Event("cartUpdated"));
  };

  const changeQty = (id, delta) => {
    const updated = items.map((i) => {
      if (i.id !== id) return i;
      const next = Number(i.quantity) + delta;
      return { ...i, quantity: next < 1 ? 1 : next };
    });
    persist(updated);
  };

  const removeItem = (id) => {
    persist(items.filter((i) => i.id !== id));
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-5">
        <div style={{ fontSize: 60 }}>🛒</div>
        <h4 className="mt-3">Your cart is empty</h4>
        <p className="text-muted">Looks like you haven't added anything yet.</p>
        <Link to="/shop" className="btn btn-primary customer-btn">Continue Shopping</Link>
      </div>
    );
  }

  const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);

  return (
    <div>
      <h3 className="cust-page-title mb-1">My Cart</h3>
      <p className="text-muted mb-4">{items.length} item{items.length > 1 ? "s" : ""} in your cart</p>

      <div className="row g-4">
        <div className="col-lg-8">
          {items.map((i) => (
            <div key={i.id} className="card shadow-sm cust-card mb-3">
              <div className="row g-0 align-items-center">
                <div className="col-3 col-md-2 p-2">
                  <img src={getImageSrc(i.image)} alt={i.name} className="rounded cart-thumb" onError={(e) => (e.target.src = "/no-image.png")} />
                </div>
                <div className="col-9 col-md-6 p-2">
                  <Link to={`/shop/product/${i.id}`} className="fw-semibold text-decoration-none" style={{ color: "var(--text)" }}>{i.name}</Link>
                  <div className="text-muted small">{i.sku ? `SKU: ${i.sku}` : ""}</div>
                  <div className="fw-semibold mt-1">{formatINR(i.price)}</div>
                </div>
                <div className="col-8 col-md-3 p-2">
                  <div className="d-flex align-items-center justify-content-center mb-1">
                    <button className="btn btn-outline-secondary btn-sm" onClick={() => changeQty(i.id, -1)} disabled={Number(i.quantity) <= 1}>−</button>
                    <span className="px-3 fw-semibold">{i.quantity}</span>
                    <button className="btn btn-outline-secondary btn-sm" onClick={() => changeQty(i.id, 1)}>+</button>
                  </div>
                  <div className="text-center small text-muted">Subtotal: {formatINR(Number(i.price) * Number(i.quantity))}</div>
                </div>
                <div className="col-4 col-md-1 p-2 text-end">
                  <button className="btn btn-outline-danger btn-sm" onClick={() => removeItem(i.id)}>✕</button>
                </div>
              </div>
            </div>
          ))}

          <div className="mt-2">
            <Link to="/shop" className="btn btn-outline-primary customer-btn">← Continue Shopping</Link>
          </div>
        </div>

        {/* SUMMARY */}
        <div className="col-lg-4">
          <div className="card shadow-sm cust-card">
            <div className="card-header cust-card-header">Order Summary</div>
            <div className="card-body">
              <div className="d-flex justify-content-between mb-2">
                <span>Subtotal</span><span>{formatINR(subtotal)}</span>
              </div>
              <div className="d-flex justify-content-between mb-2 text-muted">
                <span>GST</span><span>Calculated at checkout</span>
              </div>
              <hr />
              <div className="d-flex justify-content-between fw-bold fs-5">
                <span>Total</span><span>{formatINR(subtotal)}</span>
              </div>
              <button
                className="btn btn-primary w-100 mt-3 customer-btn"
                onClick={() => navigate("/checkout")}
              >
                Proceed to Checkout →
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .cart-thumb { width:100%; height:72px; object-fit:cover; }
        .customer-btn { border-radius:999px; }
      `}</style>
    </div>
  );
}
