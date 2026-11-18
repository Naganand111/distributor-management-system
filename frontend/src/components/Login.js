import React, { useState } from "react";
import api from "../lib/api";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { FiZap, FiEye, FiEyeOff, FiArrowRight, FiBox, FiTruck, FiShoppingCart, FiMapPin, FiTrendingUp } from "react-icons/fi";
import "./Login.css";

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.45, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] } }),
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", res.data.accessToken);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      if (res.data.user.role === "admin") navigate("/admin/dashboard");
      else navigate("/shop");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-premium">
      {/* LEFT: animated distribution visual */}
      <div className="auth-visual">
        <div className="auth-aurora" />
        <motion.div
          className="auth-brand"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="auth-brand-logo"><FiZap /></span>
          <span className="auth-brand-name">
            <strong>DMS</strong> <em>Distribution Management</em>
          </span>
        </motion.div>

        <motion.h2
          className="auth-visual-title"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          Run your entire <span className="gradient-text">distribution network</span> from one command center.
        </motion.h2>

        {/* Floating 3D-ish chips */}
        <div className="auth-network">
          {[
            { icon: <FiBox />, x: 60, y: 80, label: "Warehouse", float: 0 },
            { icon: <FiTrendingUp />, x: 210, y: 40, label: "Analytics", float: 1.2 },
            { icon: <FiTruck />, x: 340, y: 110, label: "Delivery", float: 0.6 },
            { icon: <FiShoppingCart />, x: 130, y: 190, label: "Orders", float: 0.3 },
            { icon: <FiMapPin />, x: 300, y: 210, label: "Retailers", float: 0.9 },
          ].map((n, i) => (
            <motion.div
              key={i}
              className="auth-chip"
              style={{ left: n.x, top: n.y }}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.4 + i * 0.12 }}
            >
              <motion.div
                className="auth-chip-inner"
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 4, repeat: Infinity, delay: n.float, ease: "easeInOut" }}
              >
                <span className="auth-chip-ico">{n.icon}</span>
                {n.label}
              </motion.div>
            </motion.div>
          ))}
          <div className="auth-rings">
            <span /><span /><span />
          </div>
        </div>
      </div>

      {/* RIGHT: login form */}
      <div className="auth-panel">
        <motion.div className="auth-card" animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 30 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
          <motion.div className="auth-mobile-brand">
            <span className="auth-brand-logo"><FiZap /></span>
            <span className="auth-brand-name"><strong>DMS</strong></span>
          </motion.div>

          <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={0}>
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-subtitle">Sign in to your DMS account</p>
          </motion.div>

          {error && (
            <motion.div className="auth-error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="alert">
              {error}
            </motion.div>
          )}

          <form onSubmit={submit} noValidate>
            <motion.div className="auth-field" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
              <label htmlFor="email" className="auth-label">Email</label>
              <input
                id="email"
                type="email"
                required
                className="auth-input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </motion.div>

            <motion.div className="auth-field" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
              <div className="auth-label-row">
                <label htmlFor="password" className="auth-label">Password</label>
                <Link to="/forgot-password" className="auth-forgot">Forgot?</Link>
              </div>
              <div className="auth-password">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  required
                  className="auth-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" className="auth-eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
            </motion.div>

            <motion.button type="submit" className="auth-submit" disabled={loading} variants={fadeUp} initial="hidden" animate="visible" custom={3}>
              {loading ? (
                <span className="auth-btn-loading"><span className="spinner-ring" style={{ width: 18, height: 18, borderWidth: 2 }} /> Signing in…</span>
              ) : (
                <>
                  Sign In <FiArrowRight />
                </>
              )}
            </motion.button>
          </form>

          <motion.p className="auth-footer" variants={fadeUp} initial="hidden" animate="visible" custom={4}>
            Don&apos;t have an account? <Link to="/register">Create one</Link>
          </motion.p>

          <motion.div className="auth-demo-hint" variants={fadeUp} initial="hidden" animate="visible" custom={5}>
            <Link to="/">← Back to home</Link>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
