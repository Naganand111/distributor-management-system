import React from "react";
import { motion } from "framer-motion";
import {
  FiBox,
  FiBarChart2,
  FiShoppingCart,
  FiMapPin,
  FiCreditCard,
  FiFileText,
} from "react-icons/fi";
import { staggerContainer, staggerItem, viewportOnce } from "./variants";

const FEATURES = [
  {
    icon: <FiBox />,
    title: "Product Management",
    desc: "Manage products, pricing and stock efficiently.",
    color: "var(--primary)",
  },
  {
    icon: <FiBarChart2 />,
    title: "Inventory Control",
    desc: "Track stock movements and low inventory levels.",
    color: "var(--accent)",
  },
  {
    icon: <FiShoppingCart />,
    title: "Order Management",
    desc: "Process and monitor customer orders easily.",
    color: "var(--secondary)",
  },
  {
    icon: <FiMapPin />,
    title: "Retailer Management",
    desc: "Manage retailers and business relationships.",
    color: "var(--primary)",
  },
  {
    icon: <FiCreditCard />,
    title: "Payments",
    desc: "Track COD and online payments securely.",
    color: "var(--accent)",
  },
  {
    icon: <FiFileText />,
    title: "Smart Invoices",
    desc: "Generate and manage invoices efficiently.",
    color: "var(--secondary)",
  },
];

export default function Features() {
  return (
    <section className="ln-section" id="features">
      <div className="ln-container">
        <motion.div
          className="ln-section-head"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.6 }}
        >
          <h2 className="ln-title">Everything You Need to Run Your Business</h2>
          <p className="ln-sub">
            A complete order and distribution management suite that simplifies
            operations from product to payment.
          </p>
        </motion.div>

        <motion.div
          className="ln-features-grid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.title}
              className="ln-feature"
              variants={staggerItem}
              whileHover={{ y: -6 }}
            >
              <motion.span
                className="ln-feature-ico"
                style={{ background: `color-mix(in srgb, ${f.color} 14%, white)`, color: f.color }}
                whileHover={{ scale: 1.08 }}
              >
                {f.icon}
              </motion.span>
              <h3 className="ln-feature-title">{f.title}</h3>
              <p className="ln-feature-desc">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
