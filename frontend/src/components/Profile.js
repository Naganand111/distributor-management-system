import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { clearAuth } from "../lib/auth";

export default function Profile() {
  const [retailers, setRetailers] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", mobile: "", address: "", city: "", state: "", pincode: "", retailer_id: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState({ currentPassword: "", newPassword: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState("");

  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get("/profile").catch(() => null),
      api.get("/retailers/customer-list").catch(() => []),
    ]).then(([prof, rets]) => {
      setRetailers(Array.isArray(rets.data) ? rets.data : []);
      if (prof?.data) {
        setForm({
          name: prof.data.name || "",
          email: prof.data.email || "",
          mobile: prof.data.mobile || "",
          address: prof.data.address || "",
          city: prof.data.city || "",
          state: prof.data.state || "",
          pincode: prof.data.pincode || "",
          retailer_id: prof.data.retailer_id ? String(prof.data.retailer_id) : "",
        });
      }
    });
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveProfile = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await api.put("/profile", form);
      setMessage({ type: "success", text: "Profile updated successfully." });
      localStorage.setItem("user", JSON.stringify({ ...(JSON.parse(localStorage.getItem("user") || "{}")), name: res.data.data.name, email: res.data.data.email }));
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.error || "Failed to update profile" });
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setPwSaving(true);
    setPwMessage("");
    try {
      await api.put("/profile/change-password", password);
      setPwMessage({ type: "success", text: "Password changed successfully. Please login again." });
      setPassword({ currentPassword: "", newPassword: "" });
      setTimeout(() => {
        clearAuth();
        navigate("/login");
      }, 1200);
    } catch (err) {
      setPwMessage({ type: "danger", text: err.response?.data?.error || "Failed to change password" });
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div>
      <h3 className="cust-page-title mb-1">My Profile</h3>
      <p className="text-muted mb-4">Manage your account details. These are used to pre-fill checkout.</p>

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="card shadow-sm cust-card">
            <div className="card-header cust-card-header">Account Information</div>
            <div className="card-body">
              {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Full Name *</label>
                  <input className="form-control" value={form.name} onChange={set("name")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Email</label>
                  <input className="form-control" type="email" value={form.email} onChange={set("email")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Mobile</label>
                  <input className="form-control" value={form.mobile} onChange={set("mobile")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Pincode</label>
                  <input className="form-control" value={form.pincode} onChange={set("pincode")} />
                </div>
                <div className="col-12">
                  <label className="form-label">Address</label>
                  <input className="form-control" value={form.address} onChange={set("address")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">City</label>
                  <input className="form-control" value={form.city} onChange={set("city")} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">State</label>
                  <input className="form-control" value={form.state} onChange={set("state")} />
                </div>
                <div className="col-12">
                  <label className="form-label">Retailer (optional — for distributor orders)</label>
                  <select className="form-select" value={form.retailer_id} onChange={set("retailer_id")}>
                    <option value="">None</option>
                    {retailers.map((r) => (
                      <option key={r.id} value={String(r.id)}>{r.name}{r.shop_name ? ` (${r.shop_name})` : ""}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn btn-primary cust-btn mt-3" onClick={saveProfile} disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card shadow-sm cust-card">
            <div className="card-header cust-card-header">Change Password</div>
            <div className="card-body">
              {pwMessage && <div className={`alert alert-${pwMessage.type}`}>{pwMessage.text}</div>}
              <div className="mb-3">
                <label className="form-label">Current Password</label>
                <input className="form-control" type="password" value={password.currentPassword} onChange={(e) => setPassword((p) => ({ ...p, currentPassword: e.target.value }))} />
              </div>
              <div className="mb-3">
                <label className="form-label">New Password</label>
                <input className="form-control" type="password" value={password.newPassword} onChange={(e) => setPassword((p) => ({ ...p, newPassword: e.target.value }))} />
              </div>
              <button className="btn btn-outline-primary cust-btn" onClick={changePassword} disabled={pwSaving}>
                {pwSaving ? "Updating…" : "Change Password"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`.cust-btn{border-radius:999px;} .cust-card{border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface);} .cust-card-header{background:var(--surface-2);font-weight:700;padding:14px 18px;border-bottom:1px solid var(--border);color:var(--text);}`}</style>
    </div>
  );
}
