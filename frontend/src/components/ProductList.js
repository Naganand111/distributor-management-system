import React, { useEffect, useState } from "react";
import { getCart, setCart, getUser } from "../lib/auth";
import api from "../lib/api";
import { API_ORIGIN } from "../lib/config";

/* 🔗 FIX IMAGE URL */
function getImageSrc(image) {
  if (!image) return "/no-image.png";
  if (/^https?:\/\//i.test(image)) return image;
  return `${API_ORIGIN}${image.startsWith("/") ? image : `/${image}`}`;
}

/* ⭐ Star helpers */
function Star({ filled, size = 16 }) {
  return (
    <span
      style={{
        color: filled ? "#f5a623" : "#d9d9d9",
        fontSize: `${size}px`,
        marginRight: "1px",
      }}
    >
      ★
    </span>
  );
}

function StarRow({ rating }) {
  const r = Math.round(Number(rating) || 0);
  return (
    <span>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} filled={n <= r} />
      ))}
    </span>
  );
}

export default function ProductList() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("default");
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(true);

  const [reviewProduct, setReviewProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [myReview, setMyReview] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewMsg, setReviewMsg] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);

  const user = getUser();

  const loadProducts = () => {
    setLoading(true);

    api
      .get("/products")
      .then((res) => {
        const data = Array.isArray(res.data.data) ? res.data.data : [];
        setProducts(data);
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  };

  /* 🔥 FETCH PRODUCTS */
  useEffect(() => {
    loadProducts();
  }, []);

  /* ❤️ LOAD WISHLIST */
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("wishlist") || "[]");
    setWishlist(saved);
  }, []);

  /* ⭐ Open review modal */
  const openReviews = async (prod) => {
    setReviewProduct(prod);
    setReviews([]);
    setMyReview(null);
    setReviewComment("");
    setReviewMsg("");

    try {
      const [listRes, mineRes] = await Promise.all([
        api.get(`/products/${prod.id}/reviews`),
        user ? api.get(`/products/${prod.id}/reviews/mine`) : Promise.resolve(null),
      ]);

      setReviews(Array.isArray(listRes.data.data) ? listRes.data.data : []);

      if (mineRes?.data?.data) {
        setMyReview(mineRes.data.data);
        setReviewRating(mineRes.data.data.rating);
        setReviewComment(mineRes.data.data.comment || "");
      }
    } catch (err) {
      console.error("Load reviews error:", err);
    }
  };

  const closeReviews = () => setReviewProduct(null);

  /* ⭐ Submit review */
  const submitReview = async (e) => {
    e.preventDefault();
    if (!reviewProduct) return;

    setReviewLoading(true);
    setReviewMsg("");

    try {
      const res = await api.post(`/products/${reviewProduct.id}/reviews`, {
        rating: reviewRating,
        comment: reviewComment,
      });

      setMyReview(res.data.data || { rating: reviewRating, comment: reviewComment });
      setReviewMsg("✅ Review saved!");

      // Refresh the list + modal reviews
      const listRes = await api.get(`/products/${reviewProduct.id}/reviews`);
      setReviews(Array.isArray(listRes.data.data) ? listRes.data.data : []);
      loadProducts();
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Failed to save review";
      setReviewMsg(`❌ ${msg}`);
    } finally {
      setReviewLoading(false);
    }
  };

  /* ⭐ Delete own review */
  const deleteReview = async (review) => {
    if (!window.confirm("Delete this review?")) return;

    try {
      await api.delete(`/products/${reviewProduct.id}/reviews/${review.id}`);
      setMyReview(null);
      setReviewComment("");
      const listRes = await api.get(`/products/${reviewProduct.id}/reviews`);
      setReviews(Array.isArray(listRes.data.data) ? listRes.data.data : []);
      loadProducts();
    } catch (err) {
      console.error(err);
    }
  };

  /* 🛒 ADD TO CART (FIXED 🔥) */
  const addToCart = (prod) => {
    const cart = getCart() || [];

    const existing = cart.find((i) => i.id === prod.id);

    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({
        id: prod.id, // ✅ FIXED
        name: prod.name,
        price: Number(prod.price),
        quantity: 1,
        image: prod.image || "",
      });
    }

    setCart(cart);

    window.dispatchEvent(new Event("cartUpdated"));

    alert("✅ Added to cart");
  };

  /* ❤️ WISHLIST */
  const toggleWishlist = (prod) => {
    let updated = [...wishlist];

    if (updated.some((i) => i.id === prod.id)) {
      updated = updated.filter((i) => i.id !== prod.id);
    } else {
      updated.push({ id: prod.id, name: prod.name });
    }

    setWishlist(updated);
    localStorage.setItem("wishlist", JSON.stringify(updated));
  };

  const isInWishlist = (id) => wishlist.some((i) => i.id === id);

  /* 🎯 FILTER + SORT */
  const categories = [
    "all",
    ...new Set(products.map((p) => p.category ?? "Other")),
  ];

  const filtered = products.filter(
    (p) =>
      (category === "all" || (p.category ?? "Other") === category) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.description ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "priceLow") return a.price - b.price;
    if (sort === "priceHigh") return b.price - a.price;
    if (sort === "name") return a.name.localeCompare(b.name);
    return 0;
  });

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Store</h2>

      {/* 🔍 FILTERS */}
      <div style={styles.filters}>
        <input
          placeholder="Search products"
          style={styles.input}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          style={styles.select}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>

        <select style={styles.select} onChange={(e) => setSort(e.target.value)}>
          <option value="default">Sort</option>
          <option value="priceLow">Price ↑</option>
          <option value="priceHigh">Price ↓</option>
          <option value="name">Name</option>
        </select>
      </div>

      {/* 🛍️ PRODUCTS */}
      {loading ? (
        <div style={styles.grid}>
          {[...Array(8)].map((_, i) => (
            <div key={i} style={styles.skeleton}></div>
          ))}
        </div>
      ) : (
        <div style={styles.grid}>
          {sorted.map((p) => {
            const hasRating = Number(p.rating_count || 0) > 0;

            return (
              <div key={p.id} style={styles.card} className="apple-card">
                {/* IMAGE */}
                <div style={styles.image}>
                  <img
                    src={getImageSrc(p.image)}
                    alt={p.name}
                    style={styles.img}
                    onError={(e) => {
                      e.target.src = "/no-image.png";
                    }}
                  />
                </div>

                {/* ❤️ WISHLIST */}
                <button
                  style={styles.wishlist}
                  onClick={() => toggleWishlist(p)}
                >
                  {isInWishlist(p.id) ? "❤️" : "🤍"}
                </button>

                <h4 style={styles.name}>{p.name}</h4>
                <p style={styles.desc}>{p.description}</p>

                {/* ⭐ RATINGS */}
                {hasRating ? (
                  <button style={styles.rating} onClick={() => openReviews(p)}>
                    <StarRow rating={p.avg_rating} size={14} />
                    <span style={styles.ratingText}>
                      {Number(p.avg_rating).toFixed(1)} ({p.rating_count})
                    </span>
                  </button>
                ) : (
                  <button style={styles.rating} onClick={() => openReviews(p)}>
                    <StarRow rating={0} size={14} />
                    <span style={styles.ratingText}>No reviews yet</span>
                  </button>
                )}

                <div style={styles.bottom}>
                  <span style={styles.price}>₹{p.price}</span>

                  {user?.role === "customer" && (
                    <button
                      style={styles.button}
                      onClick={() => addToCart(p)}
                      disabled={p.stock === 0}
                    >
                      {p.stock === 0 ? "Out" : "Add"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ⭐ REVIEWS MODAL */}
      {reviewProduct && (
        <div style={styles.overlay} onClick={closeReviews}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h4 style={{ margin: 0 }}>⭐⭐ {reviewProduct.name}</h4>
              <button style={styles.closeBtn} onClick={closeReviews}>
                ✕
              </button>
            </div>

            {/* WRITE REVIEW (purchased customers only) */}
            {user?.role === "customer" && (
              <form onSubmit={submitReview} style={styles.reviewForm}>
                <div style={styles.starPicker}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setReviewRating(n)}
                      style={{
                        ...styles.starPickerBtn,
                        color: n <= reviewRating ? "#f5a623" : "#d9d9d9",
                      }}
                    >
                      ★
                    </button>
                  ))}
                  <span style={{ marginLeft: 8 }}>{reviewRating}/5</span>
                </div>

                <textarea
                  placeholder="Share your experience (optional)..."
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows={3}
                  style={styles.textarea}
                />

                <button
                  type="submit"
                  disabled={reviewLoading}
                  style={styles.submitBtn}
                >
                  {reviewLoading
                    ? "Saving..."
                    : myReview
                      ? "Update Review"
                      : "Submit Review"}
                </button>

                {myReview && (
                  <button
                    type="button"
                    style={styles.deleteBtn}
                    onClick={() => deleteReview(myReview)}
                  >
                    Delete my review
                  </button>
                )}

                {reviewMsg && <p style={styles.reviewMsg}>{reviewMsg}</p>}
              </form>
            )}

            {!user && (
              <p style={styles.loginHint}>
                <a href="/login">Log in</a> to write a review.
              </p>
            )}

            <hr />

            {/* REVIEW LIST */}
            {reviews.length === 0 ? (
              <p style={styles.noReviews}>No reviews yet.</p>
            ) : (
              <div style={styles.reviewList}>
                {reviews.map((r) => (
                  <div key={r.id} style={styles.reviewItem}>
                    <div style={styles.reviewTop}>
                      <strong>{r.author}</strong>
                      <StarRow rating={r.rating} size={12} />
                    </div>
                    {r.comment && <p style={styles.reviewComment}>{r.comment}</p>}
                    <span style={styles.reviewDate}>
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ✨ EFFECTS */}
      <style>
        {`
        .apple-card {
          transition: all 0.3s ease;
        }

        .apple-card:hover {
          transform: translateY(-6px) scale(1.02);
          box-shadow: 0 12px 30px rgba(0,0,0,0.08);
        }

        img:hover {
          transform: scale(1.05);
          transition: 0.3s;
        }

        @keyframes pulse {
          0% { opacity: 0.6 }
          50% { opacity: 1 }
          100% { opacity: 0.6 }
        }
        `}
      </style>
    </div>
  );
}

/* 🎨 STYLES */
const styles = {
  page: {
    padding: "40px",
    background: "#ffffff",
    minHeight: "100vh",
  },

  title: {
    fontSize: "32px",
    fontWeight: "600",
    marginBottom: "25px",
  },

  filters: {
    display: "flex",
    gap: "12px",
    marginBottom: "30px",
  },

  input: {
    flex: 1,
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #ddd",
  },

  select: {
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #ddd",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: "25px",
  },

  card: {
    position: "relative",
    background: "#fff",
    padding: "20px",
    borderRadius: "22px",
    textAlign: "center",
  },

  image: {
    height: "180px",
    background: "#f5f5f7",
    borderRadius: "16px",
    marginBottom: "12px",
    overflow: "hidden",
  },

  img: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: "16px",
  },

  wishlist: {
    position: "absolute",
    top: "12px",
    right: "12px",
    border: "none",
    background: "#fff",
    borderRadius: "50%",
    padding: "6px",
    cursor: "pointer",
  },

  name: {
    fontSize: "17px",
    fontWeight: "500",
  },

  desc: {
    fontSize: "13px",
    color: "#6e6e73",
  },

  rating: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    background: "#fff",
    border: "none",
    padding: "4px 8px",
    borderRadius: "999px",
    cursor: "pointer",
    marginTop: "6px",
  },

  ratingText: {
    fontSize: "12px",
    color: "#6e6e73",
  },

  bottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "12px",
  },

  price: {
    fontWeight: "600",
    fontSize: "16px",
  },

  button: {
    padding: "6px 16px",
    borderRadius: "999px",
    border: "none",
    background: "#0071e3",
    color: "#fff",
    cursor: "pointer",
  },

  skeleton: {
    height: "220px",
    borderRadius: "18px",
    background: "linear-gradient(90deg,#eee,#f5f5f5,#eee)",
    animation: "pulse 1.5s infinite",
  },

  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px",
  },

  modal: {
    background: "#fff",
    borderRadius: "18px",
    padding: "24px",
    width: "100%",
    maxWidth: "520px",
    maxHeight: "85vh",
    overflowY: "auto",
  },

  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },

  closeBtn: {
    border: "none",
    background: "#eee",
    borderRadius: "50%",
    width: "32px",
    height: "32px",
    cursor: "pointer",
  },

  reviewForm: {
    background: "#fafafa",
    borderRadius: "12px",
    padding: "14px",
    marginBottom: "12px",
  },

  starPicker: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
  },

  starPickerBtn: {
    background: "none",
    border: "none",
    fontSize: "24px",
    cursor: "pointer",
    padding: "0 2px",
  },

  textarea: {
    width: "100%",
    border: "1px solid #ddd",
    borderRadius: "10px",
    padding: "10px",
    fontSize: "14px",
    resize: "vertical",
  },

  submitBtn: {
    marginTop: "10px",
    padding: "8px 18px",
    borderRadius: "999px",
    border: "none",
    background: "#0071e3",
    color: "#fff",
    cursor: "pointer",
    marginRight: "8px",
  },

  deleteBtn: {
    marginTop: "10px",
    padding: "8px 18px",
    borderRadius: "999px",
    border: "1px solid #e35",
    background: "#fff",
    color: "#e35",
    cursor: "pointer",
  },

  reviewMsg: {
    marginTop: "8px",
    fontSize: "13px",
  },

  loginHint: {
    fontSize: "13px",
    color: "#6e6e73",
    marginBottom: "12px",
  },

  noReviews: {
    color: "#6e6e73",
    textAlign: "center",
    margin: "12px 0",
  },

  reviewList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },

  reviewItem: {
    border: "1px solid #eee",
    borderRadius: "10px",
    padding: "12px",
  },

  reviewTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "4px",
  },

  reviewComment: {
    margin: "4px 0",
    fontSize: "14px",
  },

  reviewDate: {
    fontSize: "12px",
    color: "#999",
  },
};