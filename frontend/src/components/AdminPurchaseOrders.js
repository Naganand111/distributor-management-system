import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast } from "./ui";

export default function AdminPurchaseOrders() {
  const [list, setList] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ supplier_id: "", order_date: "", expected_delivery: "", notes: "" });
  const [lines, setLines] = useState([]);

  const [detail, setDetail] = useState(null);
  const toast = useToast();

  const loadAll = async () => {
    setLoading(true);
    try {
      const [l, s, p] = await Promise.all([
        api.get("/purchase-orders"),
        api.get("/dms/suppliers"),
        api.get("/dms/inventory"),
      ]);
      setList(Array.isArray(l.data) ? l.data : []);
      setSuppliers(Array.isArray(s.data) ? s.data : []);
      setProducts(Array.isArray(p.data) ? p.data : []);
    } catch (err) {
      console.error("Load PO error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const addLine = () => {
    setLines([...lines, { product_id: "", quantity: 1, purchase_price: "" }]);
  };
  const updateLine = (i, key, val) => {
    const next = [...lines];
    // auto-fill price from product's purchase_price
    if (key === "product_id") {
      const prod = products.find((p) => String(p.id) === String(val));
      next[i] = { ...next[i], product_id: val, purchase_price: prod ? prod.purchase_price : "" };
    } else {
      next[i] = { ...next[i], [key]: val };
    }
    setLines(next);
  };

  const poTotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.purchase_price || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    const items = lines
      .filter((l) => l.product_id)
      .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), purchase_price: Number(l.purchase_price || 0) }));
    if (!items.length) return toast.warning("Add at least one product line");
    try {
      await api.post("/purchase-orders", { ...form, items, status: "draft" });
      toast.success("Purchase order created");
      setCreating(false);
      setForm({ supplier_id: "", order_date: "", expected_delivery: "", notes: "" });
      setLines([]);
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to create PO");
    }
  };

  const openDetail = async (id) => {
    const res = await api.get(`/purchase-orders/${id}`);
    setDetail(res.data);
  };

  const changeStatus = async (id, status) => {
    try {
      await api.post(`/purchase-orders/${id}/status`, { status });
      setDetail((d) => ({ ...d, purchase_order: { ...d.purchase_order, status } }));
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    }
  };

  // Receiving
  const [receiveQty, setReceiveQty] = useState({});
  const receive = async () => {
    const quantities = {};
    for (const it of detail.items) {
      const val = Number(receiveQty[it.id]);
      const already = Number(it.received_qty || 0);
      const remaining = Number(it.quantity) - already;
      if (val > 0) quantities[it.id] = Math.min(val, remaining);
    }
    if (!Object.keys(quantities).length) return toast.warning("Enter quantity to receive");
    try {
      const res = await api.post(`/purchase-orders/${detail.purchase_order.id}/receive`, { quantities });
      toast.success(`Received successfully. Status: ${res.data.status}`);
      setDetail(null);
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Receive failed");
    }
  };

  const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const today = new Date().toISOString().slice(0, 10);

  const statusMap = {
    draft: "secondary", sent: "primary", confirmed: "info",
    partially_received: "warning", received: "success", cancelled: "danger",
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Purchase Orders</h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary" onClick={loadAll}>Refresh</button>
          <button className="btn btn-dark" onClick={() => setCreating(!creating)}>
            {creating ? "Cancel" : "+ New Purchase Order"}
          </button>
        </div>
      </div>

      {creating && (
        <div className="card shadow-sm mb-4">
          <div className="card-header bg-white fw-semibold">Create Purchase Order</div>
          <div className="card-body">
            <form onSubmit={submit}>
              <div className="row mb-3">
                <div className="col-md-4">
                  <label className="small">Supplier</label>
                  <select className="form-select" value={form.supplier_id}
                    onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                    <option value="">— Select —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.company_name}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="small">Order Date</label>
                  <input className="form-control" type="date" max={today} value={form.order_date}
                    onChange={(e) => setForm({ ...form, order_date: e.target.value })} />
                </div>
                <div className="col-md-2">
                  <label className="small">Expected Delivery</label>
                  <input className="form-control" type="date" value={form.expected_delivery}
                    onChange={(e) => setForm({ ...form, expected_delivery: e.target.value })} />
                </div>
                <div className="col-md-4">
                  <label className="small">Notes</label>
                  <input className="form-control" value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              <h6 className="fw-semibold">Products</h6>
              {lines.map((l, i) => (
                <div className="row g-2 mb-2 align-items-center" key={i}>
                  <div className="col-md-5">
                    <select className="form-select" value={l.product_id}
                      onChange={(e) => updateLine(i, "product_id", e.target.value)}>
                      <option value="">— Product —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} (stock {p.stock || 0})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <input className="form-control" type="number" min="1" placeholder="Qty" value={l.quantity}
                      onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                  </div>
                  <div className="col-md-2">
                    <input className="form-control" type="number" placeholder="Price" value={l.purchase_price}
                      onChange={(e) => updateLine(i, "purchase_price", e.target.value)} />
                  </div>
                  <div className="col-md-2">
                    <span className="small">{fmt(Number(l.quantity || 0) * Number(l.purchase_price || 0))}</span>
                  </div>
                  <div className="col-md-1">
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setLines(lines.filter((_, x) => x !== i))}>
                      ×
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={addLine}>
                + Add Product
              </button>

              <div className="d-flex justify-content-end align-items-center gap-3">
                <strong>Total: {fmt(poTotal)}</strong>
                <button className="btn btn-dark" type="submit">Create PO</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-striped mb-0 align-middle">
              <thead>
                <tr>
                  <th>PO #</th><th>Supplier</th><th>Order Date</th><th>Expected</th>
                  <th>Amount</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((po) => (
                  <tr key={po.id}>
                    <td>{po.po_number}</td>
                    <td>{po.supplier_name || "—"}</td>
                    <td>{po.order_date || "—"}</td>
                    <td>{po.expected_delivery || "—"}</td>
                    <td>{fmt(po.total_amount)}</td>
                    <td>
                      <span className={`badge bg-${statusMap[po.status] || "secondary"}`}>{po.status}</span>
                    </td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openDetail(po.id)}>
                        View / Receive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <p className="p-3 text-muted mb-0">No purchase orders yet.</p>}
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}
          onClick={() => setDetail(null)}>
          <div className="card p-4 shadow" style={{ width: 760, maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="d-flex justify-content-between mb-3">
              <h5 className="mb-0">{detail.purchase_order.po_number}</h5>
              <span className={`badge bg-${statusMap[detail.purchase_order.status] || "secondary"}`}>
                {detail.purchase_order.status}
              </span>
            </div>
            <p className="text-muted small mb-3">
              Supplier: {detail.purchase_order.supplier_name || "—"} · Order: {detail.purchase_order.order_date || "—"}
              {" "}· Expected: {detail.purchase_order.expected_delivery || "—"}
              {" "}· Total: <strong>{fmt(detail.purchase_order.total_amount)}</strong>
            </p>

            {["draft", "sent"].includes(detail.purchase_order.status) && (
              <div className="mb-3 d-flex gap-2">
                <button className="btn btn-sm btn-outline-primary" onClick={() => changeStatus(detail.purchase_order.id, "sent")}>Send</button>
                <button className="btn btn-sm btn-outline-info" onClick={() => changeStatus(detail.purchase_order.id, "confirmed")}>Confirm</button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => changeStatus(detail.purchase_order.id, "cancelled")}>Cancel</button>
              </div>
            )}

            <table className="table table-sm align-middle mb-3">
              <thead>
                <tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th><th>Received</th><th>Receive Now</th></tr>
              </thead>
              <tbody>
                {detail.items.map((it) => {
                  const already = Number(it.received_qty || 0);
                  const remaining = Number(it.quantity) - already;
                  return (
                    <tr key={it.id}>
                      <td>{it.product_name}</td>
                      <td>{it.quantity}</td>
                      <td>{fmt(it.purchase_price)}</td>
                      <td>{fmt(it.total)}</td>
                      <td>{already}/{it.quantity}</td>
                      <td>
                        {remaining > 0 ? (
                          <input className="form-control form-control-sm" style={{ width: 80 }}
                            type="number" min="0" max={remaining} value={receiveQty[it.id] || ""}
                            onChange={(e) => setReceiveQty({ ...receiveQty, [it.id]: e.target.value })} />
                        ) : (
                          <span className="text-muted small">Done</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {detail.purchase_order.notes && (
              <p className="small text-muted">Notes: {detail.purchase_order.notes}</p>
            )}

            <div className="d-flex justify-content-end gap-2">
              <button className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
              <button className="btn btn-success"
                onClick={receive}
                disabled={!detail.items.some((it) => Number(it.received_qty) < Number(it.quantity))}>
                Receive Products
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
