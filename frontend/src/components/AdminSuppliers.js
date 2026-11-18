import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast, ConfirmModal } from "./ui";

const FIELDS = [
  ["company_name", "Company Name"],
  ["contact_person", "Contact Person"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["gst", "GST No."],
  ["address", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["pincode", "Pincode"],
];

const EMPTY = {
  company_name: "",
  contact_person: "",
  email: "",
  phone: "",
  gst: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
};

export default function AdminSuppliers() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ id: null, ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/suppliers");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load suppliers error:", err);
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
      if (form.id) {
        await api.put(`/dms/suppliers/${form.id}`, payload);
      } else {
        await api.post("/dms/suppliers", payload);
      }
      setForm({ id: null, ...EMPTY });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save supplier");
    }
  };

  const edit = (r) => {
    const next = { id: r.id };
    FIELDS.forEach(([k]) => (next[k] = r[k] || ""));
    setForm(next);
  };

  const remove = async () => {
    try {
      await api.delete(`/dms/suppliers/${deleteId}`);
      toast.success("Supplier deleted");
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
      <h2 className="mb-4">Suppliers</h2>

      <form onSubmit={save} className="card p-3 mb-4 shadow-sm">
        <div className="row g-2">
          {FIELDS.map(([k, label]) => (
            <div className="col-md-4" key={k}>
              <input
                className="form-control"
                placeholder={label}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                required={k === "company_name"}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 d-flex gap-2">
          <button className="btn btn-primary">
            {form.id ? "Update" : "Add Supplier"}
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
              <th>#</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>City</th>
              <th>GST</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.company_name}</td>
                <td>{r.contact_person}</td>
                <td>{r.phone}</td>
                <td>{r.city}</td>
                <td>{r.gst}</td>
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
        title="Delete supplier?"
        message="This will permanently remove this supplier. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
