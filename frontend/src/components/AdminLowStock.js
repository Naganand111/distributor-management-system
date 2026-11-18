import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";

export default function AdminLowStock() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/inventory/low-stock");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load low stock error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const out = rows.filter((r) => Number(r.stock) === 0);
  const low = rows.filter((r) => Number(r.stock) > 0);

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Low Stock Alerts</h2>
        <Link to="/admin/stock-in" className="btn btn-primary">
          Re-stock Now
        </Link>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="alert alert-success">
          All products are above their minimum stock level.
        </div>
      ) : null}

      <div className="mb-4">
        <h5 className="text-danger mb-3">Out of Stock ({out.length})</h5>
        {loading ? (
          <div className="loading">Loading...</div>
        ) : out.length === 0 ? (
          <p className="text-muted">None.</p>
        ) : (
          <OutTable rows={out} />
        )}
      </div>

      <div>
        <h5 className="text-warning mb-3">Below Minimum ({low.length})</h5>
        {loading ? (
          <div className="loading">Loading...</div>
        ) : low.length === 0 ? (
          <p className="text-muted">None.</p>
        ) : (
          <OutTable rows={low} />
        )}
      </div>
    </div>
  );
}

function OutTable({ rows }) {
  return (
    <table className="table table-striped shadow-sm">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Name</th>
          <th>Stock</th>
          <th>Reorder Level</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.sku}</td>
            <td>{r.name}</td>
            <td className={Number(r.stock) === 0 ? "text-danger fw-bold" : ""}>
              {r.stock}
            </td>
            <td>{r.effective_reorder_level ?? r.reorder_level ?? r.min_stock_level}</td>
            <td>
              <Link to="/admin/stock-in" className="btn btn-sm btn-primary">
                Stock In
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
