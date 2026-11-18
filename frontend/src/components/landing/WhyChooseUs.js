import React from "react";
import { motion } from "framer-motion";
import { FiCheckCircle } from "react-icons/fi";
import { staggerContainer, staggerItem, viewportOnce } from "./variants";

const BENEFITS = [
  "Centralized Management",
  "Real-time Inventory",
  "Secure Role-Based Access",
  "Smart Order Tracking",
  "Invoice Management",
  "Payment Tracking",
];

export default function WhyChooseUs() {
  return (
    <section className="ln-section">
      <div className="ln-container ln-split">
        <motion.div
          className="ln-split-left"
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <span className="ln-eyebrow">WHY CHOOSE US</span>
          <h2 className="ln-title" style={{ textAlign: "left", marginTop: 12 }}>
            Built for Modern Business Operations.
          </h2>
          <p className="ln-sub" style={{ textAlign: "left" }}>
            OMS brings together everything you need to run your distribution
            business — integrated, secure and easy to use.
          </p>
        </motion.div>

        <motion.ul
          className="ln-benefits"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
        >
          {BENEFITS.map((b) => (
            <motion.li key={b} className="ln-benefit" variants={staggerItem}>
              <span className="ln-benefit-check"><FiCheckCircle /></span>
              {b}
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
