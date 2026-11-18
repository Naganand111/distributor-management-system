import React, { useEffect, useState } from "react";
import api from "../lib/api";

export default function AdminStockIn() {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([
    { product_id: "", quantity: 1, purchase_price: "", expiry_date: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = async () => {
    try {
      const [inv, sup] = await Promise.all([
        api.get("/dms/inventory"),
        api.get("/dms/suppliers"),
      ]);
      setProducts(Array.isArray(inv.data) ? inv.data : []);
      setSuppliers(Array.isArray(sup.data) ? sup.data : []);
      if (!items[0].product_id && inv.data?.length) {
        setItems([{ ...items[0], product_id: inv.data[0].id }]);
      }
    } catch (err) {
      console.error("Load stock-in data error:", err);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateItem = (idx, field, value) => {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it))
    );
  };

  const addRow = () =>
    setItems((prev) => [
      ...prev,
      { product_id: products[0]?.id || "", quantity: 1, purchase_price: "", expiry_date: "" },
    ]);

  const removeRow = (idx) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        supplier_id: supplierId || null,
        batch_number: batchNumber || null,
        notes: notes || null,
        items: items
          .filter((it) => it.product_id)
          .map((it) => ({
            product_id: it.product_id,
            quantity: Number(it.quantity),
            purchase_price: Number(it.purchase_price || 0),
            expiry_date: it.expiry_date || null,
          })),
      };
      const res = await api.post("/dms/stock-in", payload);
      setMessage({
        ok: true,
        text: `Stock in recorded (ID ${res.data.stockInId}). Total ₹${res.data.totalAmount}.`,
      });
      setItems([{ product_id: products[0]?.id || "", quantity: 1, purchase_price: "", expiry_date: "" }]);
      setBatchNumber("");
      setNotes("");
    } catch (err) {
      setMessage({
        ok: false,
        text: err.response?.data?.error || "Stock in failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const total = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.purchase_price) || 0),
    0
  );

  return (
    <div className="container-fluid py-4">
      <h2 className="mb-4">Stock In</h2>

      {message && (
        <div className={`alert ${message.ok ? "alert-success" : "alert-danger"}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={submit} className="card p-3 mb-4 shadow-sm">
        <div className="row g-2 mb-3">
          <div className="col-md-4">
            <label className="form-label small">Supplier</label>
            <select
              className="form-select"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">-- No supplier --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company_name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label small">Batch Number</label>
            <input
              className="form-control"
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label small">Notes</label>
            <input
              className="form-control"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <table className="table table-sm">
          <thead>
            <tr>
              <th>Product</th>
              <th style={{ width: 120 }}>Qty</th>
              <th style={{ width: 130 }}>Purchase Price</th>
              <th style={{ width: 150 }}>Expiry</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td>
                  <select
                    className="form-select"
                    value={it.product_id}
                    onChange={(e) => updateItem(idx, "product_id", e.target.value)}
                    required
                  >
                    <option value="">-- Product --</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.sku ? `(${p.sku})` : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="form-control"
                    value={it.purchase_price}
                    onChange={(e) =>
                      updateItem(idx, "purchase_price", e.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    type="date"
                    className="form-control"
                    value={it.expiry_date}
                    onChange={(e) =>
                      updateItem(idx, "expiry_date", e.target.value)
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => removeRow(idx)}
                    disabled={items.length === 1}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="d-flex justify-content-between align-items-center">
          <button type="button" className="btn btn-outline-secondary" onClick={addRow}>
            + Add Item
          </button>
          <div>
            <strong>Total: ₹{total.toFixed(2)}</strong>
          </div>
        </div>

        <div className="mt-3">
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saving..." : "Save Stock In"}
          </button>
        </div>
      </form>
    </div>
  );
}
