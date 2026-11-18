import React, { useCallback, useEffect, useState } from "react";
import api from "../lib/api";

export default function AdminDamagedExpired() {
  const [tab, setTab] = useState("alerts");
  const [damaged, setDamaged] = useState([]);
  const [expired, setExpired] = useState([]);
  const [expiredProducts, setExpiredProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e, ep, a] = await Promise.all([
        api.get("/inventory/damaged"),
        api.get("/inventory/expired"),
        api.get("/inventory/expired-products"),
        api.get(`/inventory/expiry-alerts?days=${days}`),
      ]);
      setDamaged(Array.isArray(d.data) ? d.data : []);
      setExpired(Array.isArray(e.data) ? e.data : []);
      setExpiredProducts(Array.isArray(ep.data) ? ep.data : []);
      setAlerts(Array.isArray(a.data) ? a.data : []);
    } catch (err) {
      console.error("Load inventory error:", err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const tabs = [
    ["alerts", "Expiry Alerts"],
    ["expired", "Expired"],
    ["damaged", "Damaged"],
  ];

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Damaged &amp; Expiry</h2>
        <button className="btn btn-outline-secondary" onClick={load}>Refresh</button>
      </div>

      <ul className="nav nav-pills mb-4">
        {tabs.map(([key, label]) => (
          <li className="nav-item" key={key}>
            <button
              className={`nav-link ${tab === key ? "active" : ""}`}
              style={tab === key ? { background: "var(--brand)" } : {}}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <>
          {tab === "alerts" && (
            <div className="card shadow-sm">
              <div className="card-header bg-white d-flex justify-content-between align-items-center">
                <span className="fw-semibold">Products Expiring Within N Days</span>
                <select className="form-select form-select-sm" style={{ width: 160 }} value={days}
                  onChange={(e) => setDays(e.target.value)}>
                  <option value="7">7 days</option>
                  <option value="15">15 days</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                </select>
              </div>
              <div className="table-responsive">
                <table className="table table-striped mb-0">
                  <thead>
                    <tr><th>Product</th><th>SKU</th><th>Stock</th><th>Expiry Date</th><th>Days Left</th></tr>
                  </thead>
                  <tbody>
                    {alerts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{a.sku || "—"}</td>
                        <td>{a.stock}</td>
                        <td>{a.expiry_date ? new Date(a.expiry_date).toLocaleDateString() : "—"}</td>
                        <td>
                          <span className={`badge ${a.days_left <= 7 ? "bg-danger" : a.days_left <= 15 ? "bg-warning" : "bg-info"}`}>
                            {a.days_left} days
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!alerts.length && <p className="p-3 text-muted mb-0">No products expiring within {days} days.</p>}
              </div>
            </div>
          )}

          {tab === "expired" && (
            <div className="row">
              <div className="col-md-6">
                <div className="card shadow-sm">
                  <div className="card-header bg-white fw-semibold">Already Expired (Products)</div>
                  <div className="table-responsive">
                    <table className="table table-striped mb-0">
                      <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Expiry</th></tr></thead>
                      <tbody>
                        {expiredProducts.map((e) => (
                          <tr key={e.id}>
                            <td>{e.name}</td><td>{e.sku || "—"}</td>
                            <td>{e.stock}</td>
                            <td>{e.expiry_date ? new Date(e.expiry_date).toLocaleDateString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!expiredProducts.length && <p className="p-3 text-muted mb-0">No expired products.</p>}
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="card shadow-sm">
                  <div className="card-header bg-white fw-semibold">Expired Inventory Log</div>
                  <div className="table-responsive">
                    <table className="table table-striped mb-0">
                      <thead><tr><th>Product</th><th>Qty</th><th>Expiry</th><th>Date</th></tr></thead>
                      <tbody>
                        {expired.map((e) => (
                          <tr key={e.id}>
                            <td>{e.product_name}</td><td>{e.quantity}</td>
                            <td>{e.expiry_date ? new Date(e.expiry_date).toLocaleDateString() : "—"}</td>
                            <td>{new Date(e.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!expired.length && <p className="p-3 text-muted mb-0">No expired inventory recorded.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "damaged" && (
            <div className="card shadow-sm">
              <div className="card-header bg-white fw-semibold">Damaged Inventory</div>
              <div className="table-responsive">
                <table className="table table-striped mb-0">
                  <thead>
                    <tr><th>Product</th><th>SKU</th><th>Qty</th><th>Source</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {damaged.map((d) => (
                      <tr key={d.id}>
                        <td>{d.product_name}</td>
                        <td>{d.sku || "—"}</td>
                        <td>{d.quantity}</td>
                        <td>{d.source || "return"}</td>
                        <td>{new Date(d.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!damaged.length && <p className="p-3 text-muted mb-0">No damaged inventory recorded.</p>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
