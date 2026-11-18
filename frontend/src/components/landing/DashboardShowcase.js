import React from "react";
import { motion } from "framer-motion";
import {
  FiTrendingUp,
  FiShoppingCart,
  FiBox,
  FiCheckCircle,
} from "react-icons/fi";
import { staggerContainer, staggerItem, viewportOnce } from "./variants";

function AreaChart() {
  const points = "0,80 30,60 60,72 90,38 120,50 150,22 180,34 210,10";
  return (
    <svg className="showcase-chart" viewBox="0 0 210 90" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(99,102,241,0.5)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0)" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,90 ${points} 210,90`}
        fill="url(#chartFill)"
      />
      <motion.polyline
        points={points}
        fill="none"
        stroke="#818cf8"
        strokeWidth="3"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 1.6, ease: "easeInOut" }}
      />
    </svg>
  );
}

const stats = [
  { icon: <FiTrendingUp />, label: "Revenue", value: "₹18.4L", cls: "blue" },
  { icon: <FiShoppingCart />, label: "Orders", value: "6,420", cls: "green" },
  { icon: <FiBox />, label: "Inventory", value: "94%", cls: "purple" },
];

const recent = [
  { n: "#OMS1042", v: "₹22,100", s: "Delivered" },
  { n: "#OMS1041", v: "₹9,850", s: "Shipped" },
  { n: "#OMS1040", v: "₹15,200", s: "Processing" },
  { n: "#OMS1039", v: "₹7,300", s: "Delivered" },
  { n: "#OMS1038", v: "₹12,700", s: "Paid" },
];

export default function DashboardShowcase() {
  return (
    <section className="ln-showcase" id="about">
      <div className="ln-container">
        <motion.div
          className="ln-section-head"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.6 }}
        >
          <h2 className="ln-title ln-title-light">
            Your Entire Business. One Dashboard.
          </h2>
          <p className="ln-sub ln-sub-light">
            Every metric, order and insight — at a glance.
          </p>
        </motion.div>

        <motion.div
          className="showcase-frame"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="sc-top">
            <span className="dash-dot red" />
            <span className="dash-dot yellow" />
            <span className="dash-dot green" />
            <span className="sc-title">Business Overview</span>
          </div>

          <div className="sc-body">
            <motion.div
              className="sc-stats"
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.3 }}
            >
              {stats.map((s) => (
                <motion.div key={s.label} className="sc-stat" variants={staggerItem}>
                  <span className={`sc-ico ${s.cls}`}>{s.icon}</span>
                  <div>
                    <div className="sc-stat-label">{s.label}</div>
                    <div className="sc-stat-value">{s.value}</div>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            <div className="sc-grid">
              <div className="sc-chart-panel">
                <div className="sc-panel-title">Sales Performance</div>
                <AreaChart />
              </div>

              <div className="sc-orders-panel">
                <div className="sc-panel-title">Recent Orders</div>
                {recent.map((o) => (
                  <div key={o.n} className="sc-order">
                    <span className="sc-order-n">{o.n}</span>
                    <span className="sc-order-v">{o.v}</span>
                    <span className="sc-order-s">
                      <FiCheckCircle style={{ marginRight: 4 }} /> {o.s}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
