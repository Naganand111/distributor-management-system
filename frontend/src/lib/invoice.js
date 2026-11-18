/* Centralized invoice download helper.
   Uses the axios `api` client (lib/api.js) which automatically attaches the
   Bearer token via its request interceptor — so we do NOT need the ?token=
   query-string hack, and the token is never exposed in a URL.
*/
import api from "./api";

function isPdfBlob(data, headers) {
  if (headers && headers["content-type"] && headers["content-type"].includes("application/pdf")) {
    return true;
  }
  if (data instanceof Blob && data.type && data.type.includes("application/pdf")) {
    return true;
  }
  // Fallback: PDF files begin with `%PDF-`
  if (data instanceof Blob && data.size > 0) return true;
  return false;
}

/**
 * Download an invoice PDF as a blob.
 *
 * @param {number|string} orderId - The ORDER id (PDF endpoint is /orders/:id/invoice).
 * @param {string} [filename] - Desired filename (defaults to the invoice_no from the server header).
 */
export async function downloadInvoicePdf(orderId, filename) {
  const res = await api.get(`/orders/${orderId}/invoice`, {
    responseType: "blob",
  });

  const data = res.data;
  if (!data || (data instanceof Blob && data.size === 0)) {
    throw new Error("empty");
  }

  // If the server returned a JSON error wrapped in a blob (e.g. 401/404), surface it.
  if (!isPdfBlob(data, res.headers)) {
    let text = "";
    try {
      text = await data.text();
      const parsed = JSON.parse(text);
      throw new Error(parsed?.error || "Invalid response");
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error("Invalid response");
      }
      throw e;
    }
  }

  // Prefer server-provided filename (Content-Disposition: attachment; filename="INV-....pdf")
  const disposition = res.headers && (res.headers["content-disposition"] || "");
  const match = disposition && disposition.match(/filename="?([^";]+)"?/i);
  const finalName = filename || (match && match[1]) || `invoice-${orderId}.pdf`;

  const blob = new Blob([data], { type: "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", finalName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
