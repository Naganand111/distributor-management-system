import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiCheckCircle, FiXCircle } from "react-icons/fi";
import api from "../lib/api";
import { getCart, setCart } from "../lib/auth";
import { formatINR, getImageSrc } from "../lib/utils";
import { StatusBadge } from "./OrderStatusTimeline";
import { PageTransition } from "./ui";

export default function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qty, setQty] = useState(1);

  const navigate = useNavigate();

  useEffect(() => {
    api
      .get(`/products/${id}`)
      .then((res) => setProduct(res.data.data))
      .catch(() => setError("Product not found"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-center py-5 text-muted">Loading product…</div>;
  if (error || !product) return <div className="alert alert-danger">{error || "Product not found"}</div>;

  const changeQty = (delta) => {
    setQty((q) => {
      const next = q + delta;
      if (next < 1) return 1;
      if (next > product.stock) return product.stock;
      return next;
    });
  };

  const addToCart = () => {
    const cart = getCart() || [];
    const existing = cart.find((i) => i.id === product.id);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + qty, product.stock);
    } else {
      cart.push({ id: product.id, name: product.name, price: Number(product.price), quantity: qty, image: product.image || "", sku: product.sku || "" });
    }
    setCart(cart);
    window.dispatchEvent(new Event("cartUpdated"));
    navigate("/cart");
  };

  return (
    <PageTransition>
      <nav className="mb-3">
        <Link to="/shop" className="text-decoration-none text-muted">← Back to Shop</Link>
      </nav>

      <div className="card shadow-sm cust-card pd-card">
        <div className="row g-0">
          {/* IMAGE */}
          <div className="col-md-5">
            <div className="shop-detail-img">
              <img src={getImageSrc(product.image)} alt={product.name} onError={(e) => (e.target.src = "/no-image.png")} loading="lazy" />
            </div>
          </div>

          {/* INFO */}
          <div className="col-md-7">
            <motion.div
              className="p-4"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                {product.brand && <span className="badge pd-badge">{product.brand}</span>}
                {product.category && <span className="badge pd-badge bg-light text-dark">{product.category}</span>}
              </div>

              <h3 className="fw-bold pd-title">{product.name}</h3>
              {product.sku && <div className="text-muted small">SKU: {product.sku}</div>}

              <div className="d-flex align-items-end gap-3 my-3">
                <span className="pd-price">{formatINR(product.price)}</span>
                {Number(product.mrp) > Number(product.price) && (
                  <span className="text-muted text-decoration-line-through">{formatINR(product.mrp)}</span>
                )}
              </div>

              {product.stock > 0 ? (
                <div className="pd-stock in-stock"><FiCheckCircle /> In Stock ({product.stock} available)</div>
              ) : (
                <div className="pd-stock out-stock"><FiXCircle /> Out of Stock</div>
              )}

              {product.description && (
                <p className="text-muted mb-3">{product.description}</p>
              )}

              {/* QUANTITY */}
              {product.stock > 0 && (
                <>
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <span className="me-2">Quantity:</span>
                    <button className="btn btn-outline-secondary btn-sm pd-qty-btn" onClick={() => changeQty(-1)} disabled={qty <= 1}>−</button>
                    <span className="px-3 fw-semibold">{qty}</span>
                    <button className="btn btn-outline-secondary btn-sm pd-qty-btn" onClick={() => changeQty(1)} disabled={qty >= product.stock}>+</button>
                  </div>

                  <button className="cust-add-btn" onClick={addToCart} disabled={product.stock <= 0}>
                    Add to Cart
                  </button>
                </>
              )}

              <div className="mt-3">
                <Link to="/cart" className="btn btn-outline-primary cust-add-btn">Go to Cart</Link>
              </div>

              <hr />
              <p className="small text-muted mb-0"><StatusBadge status={product.status} /> &nbsp; Product availability is subject to stock.</p>
            </motion.div>
          </div>
        </div>
      </div>

      <style>{`
        .pd-card { border:1px solid var(--border); border-radius:22px; overflow:hidden; background:var(--surface); box-shadow: var(--shadow-md); }
        .shop-detail-img { height:100%; min-height:360px; background: linear-gradient(135deg, var(--surface-2), var(--bg-alt)); }
        .shop-detail-img img { width:100%; height:100%; object-fit:cover; }
        .pd-badge { border-radius:999px; font-weight:700; padding:5px 12px; background: var(--grad-brand); color:#fff; border:none; }
        .pd-title { font-size:1.7rem; letter-spacing:-.02em; }
        .pd-price { font-size:2rem; font-weight:800; color:var(--text); }
        .pd-stock { font-weight:700; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
        .pd-stock.in-stock { color: var(--success); }
        .pd-stock.out-stock { color: var(--danger); }
        .pd-qty-btn { border-radius:999px; width:36px; }
        .cust-add-btn {
          border:none; border-radius:999px; padding:11px 26px; font-weight:700;
          background: var(--grad-brand); color:#fff;
          box-shadow: 0 10px 24px -10px var(--glow-brand);
          transition: filter .2s ease, transform .15s ease, box-shadow .2s ease;
        }
        .cust-add-btn:hover:not(:disabled) { filter:brightness(1.06); transform:translateY(-1px); box-shadow:0 14px 28px -10px var(--glow-brand); }
        .cust-add-btn:active:not(:disabled) { transform:scale(.97); }
        .cust-add-btn:disabled { background:var(--surface-2); color:var(--text-muted); box-shadow:none; }
      `}</style>
    </PageTransition>
  );
}
