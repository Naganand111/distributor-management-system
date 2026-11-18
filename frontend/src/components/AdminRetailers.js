import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast, ConfirmModal } from "./ui";

const FIELDS = [
  ["retailer_code", "Retailer Code"],
  ["name", "Name"],
  ["shop_name", "Shop Name"],
  ["owner_name", "Owner Name"],
  ["email", "Email"],
  ["mobile", "Mobile"],
  ["gst", "GST No."],
  ["address", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["pincode", "Pincode"],
];

const EMPTY = {
  retailer_code: "",
  name: "",
  shop_name: "",
  owner_name: "",
  email: "",
  mobile: "",
  gst: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  credit_limit: 0,
};

export default function AdminRetailers() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ id: null, ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/retailers");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load retailers error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {};
      FIELDS.forEach(([k]) => (payload[k] = form[k]));
      payload.credit_limit = Number(form.credit_limit || 0);
      if (form.id) {
        await api.put(`/dms/retailers/${form.id}`, payload);
      } else {
        await api.post("/dms/retailers", payload);
      }
      setForm({ id: null, ...EMPTY });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save retailer");
    }
  };

  const edit = (r) => {
    const next = { id: r.id };
    FIELDS.forEach(([k]) => (next[k] = r[k] || ""));
    next.credit_limit = r.credit_limit ?? 0;
    setForm(next);
  };

  const remove = async () => {
    try {
      await api.delete(`/dms/retailers/${deleteId}`);
      toast.success("Retailer deleted");
      load();
    } catch (err) {
      toast.error("Delete failed. " + (err.response?.data?.error || ""));
    } finally {
      setDeleteId(null);
    }
  };

  const reset = () => setForm({ id: null, ...EMPTY });

  return (
    <div className="container-fluid py-4">
      <h2 className="mb-4">Retailers</h2>

      <form onSubmit={save} className="card p-3 mb-4 shadow-sm">
        <div className="row g-2">
          <div className="col-md-3">
            <input
              className="form-control"
              placeholder="Retailer Code"
              value={form.retailer_code}
              onChange={(e) =>
                setForm({ ...form, retailer_code: e.target.value })
              }
            />
          </div>
          {FIELDS.filter(([k]) => k !== "retailer_code").map(([k, label]) => (
            <div className="col-md-3" key={k}>
              <input
                className="form-control"
                placeholder={label}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                required={k === "name"}
              />
            </div>
          ))}
          <div className="col-md-3">
            <input
              type="number"
              className="form-control"
              placeholder="Credit Limit"
              value={form.credit_limit}
              onChange={(e) =>
                setForm({ ...form, credit_limit: e.target.value })
              }
            />
          </div>
        </div>
        <div className="mt-3 d-flex gap-2">
          <button className="btn btn-primary">
            {form.id ? "Update" : "Add Retailer"}
          </button>
          {form.id && (
            <button type="button" className="btn btn-secondary" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <table className="table table-striped shadow-sm">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Shop</th>
              <th>Mobile</th>
              <th>City</th>
              <th>Credit Limit</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.retailer_code}</td>
                <td>{r.name}</td>
                <td>{r.shop_name}</td>
                <td>{r.mobile}</td>
                <td>{r.city}</td>
                <td>₹{r.credit_limit}</td>
                <td>₹{r.outstanding_balance}</td>
                <td>
                  <span className="badge">{r.status}</span>
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-warning me-2"
                    onClick={() => edit(r)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => setDeleteId(r.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ConfirmModal
        open={deleteId !== null}
        title="Delete retailer?"
        message="This will permanently remove this retailer. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
