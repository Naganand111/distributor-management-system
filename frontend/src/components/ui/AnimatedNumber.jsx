import React, { useEffect, useState, useRef } from "react";
import { animate, useInView } from "framer-motion";

const raw = (v) =>
  String(v ?? 0).replace(/[₹,%\s]/g, "");

/* Animates a numeric value counting up when it enters the viewport.
   Supports prefixes/suffixes (e.g. "₹", "%"). */
export default function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0, duration = 1.4 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (!inView) return;
    const target = Number(raw(value)) || 0;
    const controls = animate(0, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        const formatted = v.toLocaleString("en-IN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
        setDisplay(formatted);
      },
    });
    return () => controls.stop();
  }, [inView, value, duration, decimals]);

  return (
    <span ref={ref}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
