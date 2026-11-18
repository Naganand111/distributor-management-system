import { useState } from "react";
import api from "../lib/api";

export default function AdminBilling() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!from || !to) {
      alert("Select date range");
      return;
    }

    try {
      setLoading(true);
      const res = await api.get(`/billing?from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      console.error(err);
      alert("Failed to load billing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container-fluid p-4">
      <h2 className="mb-4 fw-bold">💰 Billing Report</h2>

      {/* FILTER CARD */}
      <div className="card shadow-sm border-0 mb-4">
        <div className="card-body d-flex flex-wrap gap-3 align-items-end">
          <div>
            <label className="form-label">From</label>
            <input
              type="date"
              className="form-control"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="form-label">To</label>
            <input
              type="date"
              className="form-control"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" onClick={load}>
            {loading ? "Loading..." : "📊 Generate"}
          </button>
        </div>
      </div>

      {/* SUMMARY */}
      {data && (
        <>
          <div className="row g-4 mb-4">
            <div className="col-md-6">
              <div className="card shadow-sm border-0 p-3">
                <h6 className="text-muted">Total Orders</h6>
                <h3>{data.summary.totalOrders}</h3>
              </div>
            </div>

            <div className="col-md-6">
              <div className="card shadow-sm border-0 p-3">
                <h6 className="text-muted">Total Revenue</h6>
                <h3 className="text-success">
                  ₹{Number(data.summary.totalRevenue).toFixed(2)}
                </h3>
              </div>
            </div>
          </div>

          {/* TABLE */}
          <div className="card shadow-sm border-0">
            <div className="card-body">
              <h5 className="mb-3">📦 Orders</h5>

              <div className="table-responsive">
                <table className="table table-hover">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>#{o.id}</strong>
                        </td>

                        <td>{o.customer}</td>

                        <td>₹{Number(o.total_amount).toFixed(2)}</td>

                        <td>
                          <span
                            className={`badge ${
                              o.status === "delivered"
                                ? "bg-success"
                                : o.status === "shipped"
                                  ? "bg-primary"
                                  : o.status === "confirmed"
                                    ? "bg-warning text-dark"
                                    : "bg-secondary"
                            }`}
                          >
                            {o.status}
                          </span>
                        </td>

                        <td>{o.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {data.orders.length === 0 && (
                  <p className="text-center text-muted mt-3">
                    No data found for selected dates
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
