import React, { useState } from "react";
import api from "../lib/api";
import { Link, useNavigate } from "react-router-dom";
import "./Auth.css";

export default function ForgotPassword() {
  const [step, setStep] = useState(1); // 1: email, 2: otp, 3: new password
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  /* STEP 1: request OTP */
  const requestOtp = async () => {
    setError("");
    setInfo("");
    setLoading(true);

    try {
      const res = await api.post("/auth/forgot-password", { email });
      setInfo(res.data.message);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  /* STEP 2: verify OTP */
  const verifyOtp = async () => {
    setError("");
    setLoading(true);

    try {
      await api.post("/auth/verify-otp", { email, otp });
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  /* STEP 3: save new password */
  const resetPassword = async () => {
    setError("");

    if (newPassword !== confirm) {
      return setError("Passwords do not match");
    }

    setLoading(true);

    try {
      await api.post("/auth/reset-password", { email, newPassword });
      alert("✅ Password updated. Please login with your new password.");
      navigate("/login");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">NP</div>

        {step === 1 && (
          <>
            <h2>Forgot Password</h2>
            <p className="subtitle">
              Enter your email and we'll send you an OTP
            </p>

            {error && <p className="error">{error}</p>}
            {info && <p style={styles.info}>{info}</p>}

            <div className="input-group">
              <input
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
              <label className={email ? "active" : ""}>Email</label>
            </div>

            <button onClick={requestOtp} disabled={loading || !email}>
              {loading ? "Sending..." : "Send OTP"}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Verify OTP</h2>
            <p className="subtitle">Enter the 6-digit code sent to your email</p>

            {error && <p className="error">{error}</p>}

            <div className="input-group">
              <input
                type="text"
                value={otp}
                maxLength={6}
                onChange={(e) => setOtp(e.target.value)}
              />
              <label className={otp ? "active" : ""}>OTP</label>
            </div>

            <button onClick={verifyOtp} disabled={loading || otp.length !== 6}>
              {loading ? "Verifying..." : "Verify OTP"}
            </button>

            <p className="footer" style={{ cursor: "pointer" }} onClick={() => setStep(1)}>
              ← Back to email
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Reset Password</h2>
            <p className="subtitle">Choose a new password for {email}</p>

            {error && <p className="error">{error}</p>}

            <div className="input-group">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <label className={newPassword ? "active" : ""}>New Password</label>
            </div>

            <div className="input-group">
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <label className={confirm ? "active" : ""}>Confirm Password</label>
            </div>

            <button onClick={resetPassword} disabled={loading}>
              {loading ? "Saving..." : "Update Password"}
            </button>
          </>
        )}

        <p className="footer">
          Remembered it? <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  );
}

const styles = {
  info: {
    color: "var(--success)",
    background: "var(--success-bg)",
    borderRadius: "8px",
    padding: "8px 12px",
    fontSize: "13px",
    marginBottom: "10px",
  },
};
