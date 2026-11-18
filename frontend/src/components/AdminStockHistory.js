import React, { useEffect, useState } from "react";
import api from "../lib/api";

const TYPE_COLOR = {
  IN: "text-success",
  OUT: "text-danger",
  ADJUSTMENT: "text-warning",
};

export default function AdminStockHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/inventory-movements");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load movements error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toLocaleString();
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Stock History</h2>
        <button className="btn btn-outline-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <table className="table table-striped shadow-sm">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>SKU</th>
              <th>Type</th>
              <th>Qty</th>
              <th>Stock (prev → new)</th>
              <th>Reference</th>
              <th>Reason</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="9" className="text-muted text-center">
                  No inventory movements yet.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.created_at)}</td>
                  <td>{m.product_name}</td>
                  <td>{m.sku}</td>
                  <td className={`fw-bold ${TYPE_COLOR[m.movement_type] || ""}`}>
                    {m.movement_type}
                  </td>
                  <td>{m.quantity}</td>
                  <td>
                    {m.prev_stock} → {m.new_stock}
                  </td>
                  <td>
                    {m.reference_type}
                    {m.reference_id ? ` #${m.reference_id}` : ""}
                  </td>
                  <td>{m.reason}</td>
                  <td>{m.created_by_name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
