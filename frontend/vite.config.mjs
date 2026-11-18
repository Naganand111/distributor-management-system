import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Empty prefix keeps the existing REACT_APP_* contract intact. Shell values
  // override .env.local, matching the documented production build workflow.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: react(),
    // CRA allowed JSX in .js files; Vite only does this when configured explicitly.
    esbuild: {
      include: /\.(js|jsx|mjs|ts|tsx)$/,
      exclude: /node_modules/,
      loader: "jsx",
      jsx: "automatic",
    },
    base: "/",
    build: {
      outDir: "build",
      assetsDir: "static",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
      "process.env.REACT_APP_API_URL": JSON.stringify(env.REACT_APP_API_URL ?? ""),
      "process.env.REACT_APP_RAZORPAY_KEY_ID": JSON.stringify(env.REACT_APP_RAZORPAY_KEY_ID ?? ""),
    },
  };
});
