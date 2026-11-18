import React, { lazy, Suspense, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  FiArrowRight,
  FiBox,
  FiTruck,
  FiShoppingCart,
  FiMapPin,
} from "react-icons/fi";
import { staggerContainer, staggerItem } from "./variants";

/* Lazy-load the heavy 3D scene */
const Scene3D = lazy(() => import("./Scene3D"));

function DistroFlow() {
  const steps = [
    { icon: <FiBox />, label: "Warehouse" },
    { icon: <FiTruck />, label: "Inventory" },
    { icon: <FiShoppingCart />, label: "Orders" },
    { icon: <FiTruck />, label: "Transport" },
    { icon: <FiMapPin />, label: "Retailers" },
  ];
  return (
    <div className="distro-flow">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          {i > 0 && <span className="distro-connector" />}
          <motion.div
            className="distro-step"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 + i * 0.12, duration: 0.4 }}
          >
            <span className="distro-ico">{s.icon}</span>
            <span className="distro-label">{s.label}</span>
          </motion.div>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function Hero() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [show3D, setShow3D] = useState(false);

  useEffect(() => {
    // Lazy-render 3D after first paint for performance
    const t = setTimeout(() => setShow3D(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="ln-hero hero-premium" id="home">
      {/* Dark premium background */}
      <div className="hero-aurora" />
      <div className="bg-grid" />
      <div className="bg-blob blob-a" />
      <div className="bg-blob blob-b" />

      <div className="ln-container ln-hero-grid">
        <motion.div
          className="ln-hero-text"
          variants={reduceMotion ? {} : staggerContainer}
          initial={reduceMotion ? false : "hidden"}
          animate="visible"
        >
          <motion.span className="ln-badge" variants={staggerItem}>
            <span className="ln-badge-dot" />
            SMART DISTRIBUTION MANAGEMENT
          </motion.span>

          <motion.h1 className="ln-hero-title" variants={staggerItem}>
            Manage Your Business.
            <br />
            <span className="ln-gradient-text">Simplify Every Order.</span>
          </motion.h1>

          <motion.p className="ln-hero-sub" variants={staggerItem}>
            A modern platform to manage products, inventory, orders, retailers,
            invoices, payments and business operations from one powerful
            dashboard.
          </motion.p>

          <motion.div className="ln-hero-cta" variants={staggerItem}>
            <button
              className="ln-btn ln-btn-primary ln-btn-lg"
              onClick={() => navigate("/register")}
            >
              Get Started <FiArrowRight style={{ marginLeft: 8 }} />
            </button>
            <a href="#features" className="ln-btn ln-btn-outline ln-btn-lg ln-btn-outline-light">
              Explore Features
            </a>
          </motion.div>

          <motion.div className="ln-hero-note" variants={staggerItem}>
            <span className="note-check">✓</span> No credit card required ·
            Built for growing businesses
          </motion.div>
        </motion.div>

        <div className="ln-hero-visual">
          <div className="scene3d-wrap">
            {show3D && (
              <Suspense fallback={<div className="scene3d-fallback" />}>
                <Scene3D />
              </Suspense>
            )}
          </div>
          <div className="distro-legend">
            <DistroFlow />
          </div>
        </div>
      </div>
    </section>
  );
}
