/* Razorpay checkout helper used by Checkout and My Orders.
 *
 * The publishable key comes from REACT_APP_RAZORPAY_KEY_ID (see
 * frontend/.env.example). It is never hardcoded.
 */
import api from "./api";

const RAZORPAY_KEY = process.env.REACT_APP_RAZORPAY_KEY_ID;

export function openRazorpay({ orderId, name = "NP Store", onSuccess, onFailure }) {
  if (!RAZORPAY_KEY) {
    const err = new Error(
      "Razorpay is not configured. Set REACT_APP_RAZORPAY_KEY_ID in the frontend environment."
    );
    onFailure && onFailure(err);
    return Promise.reject(err);
  }

  return api
    // Only the local order id is sent. The payable amount is decided by the
    // server from the order row; the returned gateway order carries the amount
    // and currency Razorpay must be opened with.
    .post("/payment/create-order", { order_id: orderId })
    .then(({ data }) => {
      return new Promise((resolve, reject) => {
        const options = {
          key: RAZORPAY_KEY,
          amount: data.amount,
          currency: data.currency || "INR",
          name,
          description: "Order Payment",
          order_id: data.id,
          prefill: {
            name: name,
          },
          theme: { color: "#0071e3" },
          handler: async function (response) {
            try {
              const verify = await api.post("/payment/verify", {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                order_id: orderId,
              });
              onSuccess && onSuccess(verify.data);
              resolve({ success: true, orderId, ...verify.data });
            } catch (err) {
              onFailure && onFailure(err);
              reject(err);
            }
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function () {
          onFailure && onFailure(new Error("Payment Failed"));
          resolve({ success: false, orderId });
        });
        rzp.on("payment.cancel", function () {
          resolve({ success: false, orderId, cancelled: true });
        });
        rzp.open();
      });
    })
    .catch((err) => {
      throw err;
    });
}
