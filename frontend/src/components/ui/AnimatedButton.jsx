import React from "react";
import { motion } from "framer-motion";

/* Gradient animated button with press feedback. */
export default function AnimatedButton({
  children,
  onClick,
  variant = "primary",
  className = "",
  type = "button",
  loading = false,
  disabled = false,
  icon,
  ...rest
}) {
  return (
    <motion.button
      type={type}
      className={`gbtn gbtn-${variant} ${className}`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      animate={loading ? { opacity: [1, 0.7, 1] } : undefined}
      transition={loading ? { duration: 0.9, repeat: Infinity } : { duration: 0.14 }}
      onClick={onClick}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="gbtn-spinner" />
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </motion.button>
  );
}
