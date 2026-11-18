import React from "react";
import { motion } from "framer-motion";
import {
  FiPackage,
  FiLayers,
  FiShoppingCart,
  FiTrendingUp,
} from "react-icons/fi";
import { staggerContainer, staggerItem, viewportOnce } from "./variants";

const STEPS = [
  { n: "01", icon: <FiPackage />, title: "Add Products", desc: "Set up your catalog with pricing and SKUs in seconds." },
  { n: "02", icon: <FiLayers />, title: "Manage Inventory", desc: "Keep track of stock levels and movements in real time." },
  { n: "03", icon: <FiShoppingCart />, title: "Process Orders", desc: "Capture, track and fulfill customer orders seamlessly." },
  { n: "04", icon: <FiTrendingUp />, title: "Grow Your Business", desc: "Turn insights into action and scale operations." },
];

export default function HowItWorks() {
  return (
    <section className="ln-section ln-section-alt" id="solutions">
      <div className="ln-container">
        <motion.div
          className="ln-section-head"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.6 }}
        >
          <h2 className="ln-title">Simple. Powerful. Efficient.</h2>
          <p className="ln-sub">
            Four focused steps take you from product setup to business growth.
          </p>
        </motion.div>

        <div className="ln-steps">
          {/* Animated connecting line (desktop) */}
          <motion.div
            className="ln-steps-line"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />

          <motion.div
            className="ln-steps-grid"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
          >
            {STEPS.map((s) => (
              <motion.div key={s.n} className="ln-step" variants={staggerItem}>
                <div className="ln-step-num">{s.n}</div>
                <div className="ln-step-ico">{s.icon}</div>
                <h4 className="ln-step-title">{s.title}</h4>
                <p className="ln-step-desc">{s.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
