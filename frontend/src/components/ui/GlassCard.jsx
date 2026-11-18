import React from "react";
import { motion } from "framer-motion";

/* Premium glass card with optional hover lift and entrance animation. */
export default function GlassCard({
  children,
  className = "",
  hover = true,
  delay = 0,
  style,
  ...rest
}) {
  return (
    <motion.div
      className={`glass-card ${hover ? "glass-hover" : ""} ${className}`}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      style={style}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
