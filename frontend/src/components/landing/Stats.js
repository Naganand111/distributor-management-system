import React, { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "./variants";

function useCountUp(target, start, duration = 1500) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.floor(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target, start, duration]);

  return { ref, value };
}

function StatCard({ value, suffix = "", label, decimals = 0 }) {
  const { ref, value: v } = useCountUp(value, 0);
  const formatted =
    decimals > 0 ? (v / Math.pow(10, decimals)).toFixed(decimals) : v.toLocaleString("en-IN");
  return (
    <motion.div className="ln-stat" variants={staggerItem} whileHover={{ y: -6 }}>
      <div className="ln-stat-value" ref={ref}>
        {formatted}
        {suffix}
      </div>
      <div className="ln-stat-label">{label}</div>
    </motion.div>
  );
}

export default function Stats() {
  return (
    <section className="ln-stats">
      <motion.div
        className="ln-container ln-stats-grid"
        variants={staggerContainer}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.4 }}
      >
        <StatCard value={10} suffix="K+" label="Orders Managed" />
        <StatCard value={500} suffix="+" label="Products Tracked" />
        <StatCard value={99.9} suffix="%" label="System Reliability" decimals={1} />
        <StatCard value={24} suffix="/7" label="Business Access" />
      </motion.div>
    </section>
  );
}
