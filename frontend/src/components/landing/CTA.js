import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowRight } from "react-icons/fi";
import { viewportOnce } from "./variants";

export default function CTA() {
  const navigate = useNavigate();

  return (
    <section className="ln-cta">
      <div className="cta-blob cta-a" />
      <div className="cta-blob cta-b" />
      <div className="ln-container">
        <motion.div
          className="ln-cta-inner"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <h2 className="ln-cta-title">Ready to Simplify Your Business?</h2>
          <p className="ln-cta-sub">
            Manage your products, orders and inventory from one powerful
            platform.
          </p>
          <div className="ln-cta-actions">
            <button
              className="ln-btn ln-btn-light ln-btn-lg"
              onClick={() => navigate("/register")}
            >
              Get Started <FiArrowRight style={{ marginLeft: 8 }} />
            </button>
            <button
              className="ln-btn ln-btn-ghost-light ln-btn-lg"
              onClick={() => navigate("/login")}
            >
              Login
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
