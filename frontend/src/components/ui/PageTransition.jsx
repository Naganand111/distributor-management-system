import React from "react";
import { motion } from "framer-motion";

/* Standard page transition wrapper: fade + rise on mount.
   Wrap page content in <PageTransition> for consistent entrance. */
export default function PageTransition({ children, className = "" }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
