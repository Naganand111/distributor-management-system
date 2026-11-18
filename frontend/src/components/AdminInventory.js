import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { useToast } from "./ui";

/* Canonical LOW STOCK rule, mirroring backend utils/inventoryThreshold.js:
   the configured reorder_level wins, otherwise min_stock_level. */
function effectiveThreshold(row) {
  if (row.effective_reorder_level != null) {
    return Number(row.effective_reorder_level);
  }
  const reorder = Number(row.reorder_level || 0);
  return reorder > 0 ? reorder : Number(row.min_stock_level || 0);
}

function isLowStock(row) {
  if (row.is_low_stock != null) return Number(row.is_low_stock) === 1;
  return Number(row.stock || 0) <= effectiveThreshold(row);
}

export default function AdminInventory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/inventory");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load inventory error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openAdjust = (productId) => {
    setAdjustProduct(productId ? String(productId) : "");
    setAdjustQty("");
    setAdjustReason("");
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    const qty = Number(adjustQty);
    if (!adjustProduct) {
      toast.error("Select a product");
      return;
    }
    if (!qty || Number.isNaN(qty)) {
      toast.error("Enter a quantity change");
      return;
    }
    setAdjusting(true);
    try {
      const res = await api.post("/dms/stock-adjustment", {
        product_id: Number(adjustProduct),
        quantity: qty,
        reason: adjustReason,
      });
      setAdjustOpen(false);
      toast.success(res.data.message || "Stock adjusted successfully");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to adjust stock");
    } finally {
      setAdjusting(false);
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.name?.toLowerCase().includes(search.toLowerCase()) ||
      (r.sku || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.category || "").toLowerCase().includes(search.toLowerCase())
  );

  const stockValue = rows.reduce(
    (s, r) => s + Number(r.stock || 0) * Number(r.purchase_price || 0),
    0
  );
  const lowRows = rows.filter((r) => isLowStock(r));

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Inventory</h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-primary" onClick={() => openAdjust(null)}>
            Adjust Stock
          </button>
          <Link to="/admin/stock-in" className="btn btn-primary">
            + Stock In
          </Link>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="card p-3 shadow-sm">
            <div className="text-muted small">Products</div>
            <h4>{rows.length}</h4>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3 shadow-sm">
            <div className="text-muted small">Stock Value (cost)</div>
            <h4>₹{stockValue.toFixed(2)}</h4>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3 shadow-sm text-danger">
            <div className="text-muted small">Low / Out of Stock</div>
            <h4>{lowRows.length}</h4>
          </div>
        </div>
        <div className="col-md-3">
          <input
            className="form-control"
            placeholder="Search by name / SKU / category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <table className="table table-striped shadow-sm">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th>Brand</th>
              <th>Supplier</th>
              <th>Stock</th>
              <th>Min</th>
              <th>Purchase</th>
              <th>MRP</th>
              <th>Value</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const low = isLowStock(r);
              return (
                <tr key={r.id}>
                  <td>{r.sku}</td>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td>{r.brand}</td>
                  <td>{r.supplier}</td>
                  <td className={low ? "text-danger fw-bold" : ""}>
                    {r.stock}
                  </td>
                  <td>{effectiveThreshold(r)}</td>
                  <td>₹{r.purchase_price}</td>
                  <td>₹{r.mrp}</td>
                  <td>
                    ₹
                    {(
                      Number(r.stock || 0) * Number(r.purchase_price || 0)
                    ).toFixed(2)}
                  </td>
                  <td>
                    {low ? (
                      <span className="badge">LOW</span>
                    ) : (
                      <span className="text-success">OK</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => openAdjust(r.id)}
                      title={`Adjust stock for ${r.name}`}
                    >
                      Adjust
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ADJUST STOCK MODAL */}
      {adjustOpen && (
        <div className="confirm-overlay" onClick={() => !adjusting && setAdjustOpen(false)} role="dialog" aria-modal="true" aria-label="Adjust stock">
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">📦</div>
            <div className="confirm-title">Adjust Stock</div>
            <div className="confirm-msg text-start">
              <label className="form-label small fw-bold">Product</label>
              <select
                className="form-select mb-3"
                value={adjustProduct}
                disabled={adjusting}
                onChange={(e) => setAdjustProduct(e.target.value)}
              >
                <option value="">Select product…</option>
                {filtered.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.sku ? `(${r.sku})` : ""} — {r.stock} in stock
                  </option>
                ))}
              </select>

              <label className="form-label small fw-bold">
                Quantity change <span className="text-muted">(use − to reduce)</span>
              </label>
              <input
                className="form-control mb-3"
                type="number"
                value={adjustQty}
                disabled={adjusting}
                placeholder="e.g. 10  or  -5"
                onChange={(e) => setAdjustQty(e.target.value)}
              />

              <label className="form-label small fw-bold">Reason</label>
              <input
                className="form-control"
                value={adjustReason}
                disabled={adjusting}
                maxLength={200}
                placeholder="e.g. stock count correction, damaged goods"
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={adjusting} onClick={() => setAdjustOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={adjusting} onClick={submitAdjust}>
                {adjusting ? "Adjusting…" : "Apply Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
