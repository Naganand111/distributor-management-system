import axios from "axios";
import { API_BASE_URL } from "./config";

/* ✅ BASE URL (from REACT_APP_API_URL, no localhost fallback in production) */
const api = axios.create({
  baseURL: API_BASE_URL,
});

/* 🔐 REQUEST INTERCEPTOR */
api.interceptors.request.use(
  (config) => {
    // ✅ Attach token
    const token = localStorage.getItem("token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // ✅ FIX: Let browser handle FormData
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
    } else {
      config.headers["Content-Type"] = "application/json";
    }

    /* The assistant runs several aggregates before it can answer, so it needs a
       ceiling instead of hanging the composer forever. Scoped to the AI routes
       only: uploads and report exports keep axios' default of no timeout. */
    const url = config.url || "";
    if ((url.startsWith("/ai/") || url.startsWith("/customer-ai/")) && !config.timeout) {
      config.timeout = 20000;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

/* ⚡ RESPONSE INTERCEPTOR */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Never log raw response bodies (they can carry SQL text or tokens).
    if (process.env.NODE_ENV !== "production") {
      console.error("API ERROR:", error.response?.status, error.message);
    }

    // 🔥 Auto logout on 401
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");

      // redirect
      window.location.href = "/login";
    }

    return Promise.reject(error);
  },
);

export default api;
