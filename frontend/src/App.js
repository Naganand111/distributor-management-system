import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { getUser } from "./lib/auth";
import { ToastProvider } from "./components/ui";

// Pages
import Login from "./components/Login";
import Register from "./components/Register";
import ForgotPassword from "./components/ForgotPassword";
import Home from "./components/Home";
import Cart from "./components/Cart";
import MyOrders from "./components/MyOrders";
import OrderDetails from "./components/OrderDetails";
import InvoicePage from "./components/InvoicePage";

// Layouts
import CustomerLayout from "./components/CustomerLayout";
import AdminLayout from "./components/AdminLayout";

// Customer Panel Pages
import CustomerDashboard from "./components/CustomerDashboard";
import CustomerAssistant from "./components/CustomerAssistant";
import Shop from "./components/Shop";
import ProductDetail from "./components/ProductDetail";
import Checkout from "./components/Checkout";
import OrderSuccess from "./components/OrderSuccess";
import TrackOrder from "./components/TrackOrder";
import MyInvoices from "./components/MyInvoices";
import MyPayments from "./components/MyPayments";
import Profile from "./components/Profile";

// Admin Pages
import AdminDashboard from "./components/AdminDashboard";
import AdminProducts from "./components/AdminProducts";
import AdminOrders from "./components/AdminOrders";
import AdminUsers from "./components/AdminUsers";
import AdminBilling from "./components/Adminbilling";
import AdminReports from "./components/AdminReports";

// DMS Pages
import AdminCategories from "./components/AdminCategories";
import AdminBrands from "./components/AdminBrands";
import AdminSuppliers from "./components/AdminSuppliers";
import AdminRetailers from "./components/AdminRetailers";
import AdminInventory from "./components/AdminInventory";
import AdminStockIn from "./components/AdminStockIn";
import AdminStockHistory from "./components/AdminStockHistory";
import AdminLowStock from "./components/AdminLowStock";

// Phase 2 Pages
import AdminSalesOrders from "./components/AdminSalesOrders";
import AdminOrderTracking from "./components/AdminOrderTracking";
import AdminInvoices from "./components/AdminInvoices";
import AdminPayments from "./components/AdminPayments";

// DMS Advanced (Phases 1-5)
import AdminSalesManagement from "./components/AdminSalesManagement";
import AdminTerritories from "./components/AdminTerritories";
import AdminPurchaseOrders from "./components/AdminPurchaseOrders";
import AdminReturns from "./components/AdminReturns";
import AdminDamagedExpired from "./components/AdminDamagedExpired";

// Phases 6-9 Pages
import AdminActivityLogs from "./components/AdminActivityLogs";
import AdminAnalytics from "./components/AdminAnalytics";
import AdminReorder from "./components/AdminReorder";
import AdminGlobalSearch from "./components/AdminGlobalSearch";
import AdminAssistant from "./components/AdminAssistant";
import AdminProfit from "./components/AdminProfit";
import AdminPromotions from "./components/AdminPromotions";
import AdminCredit from "./components/AdminCredit";
import AdminDeliveries from "./components/AdminDeliveries";
import AdminWarehouses from "./components/AdminWarehouses";
import AdminBarcode from "./components/AdminBarcode";
import AdminRoutes from "./components/AdminRoutes";
import AdminVisits from "./components/AdminVisits";
import AdminSecurity from "./components/AdminSecurity";
import AdminLoyalty from "./components/AdminLoyalty";
import AdminCompanies from "./components/AdminCompanies";
import CustomerNotifications from "./components/CustomerNotifications";

/* Restricted by role */
function RequireRole({ children, role }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return user.role === "admin" ? <Navigate to="/admin/dashboard" replace /> : <Navigate to="/shop" replace />;
  return children;
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
    <ToastProvider>
    <Routes>
      {/* ✅ SMART ROOT REDIRECT */}
      <Route
        path="/"
        element={(() => {
          const user = getUser();

          if (!user) return <Navigate to="/login" replace />;

          return user.role === "admin" ? (
            <Navigate to="/admin/dashboard" replace />
          ) : (
            <Navigate to="/shop" replace />
          );
        })()}
      />

      {/* PUBLIC ROUTES */}
      <Route path="/home" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* CUSTOMER ROUTES */}
      <Route
        element={
          <RequireRole role="customer">
            <CustomerLayout />
          </RequireRole>
        }
      >
        <Route path="/customer-dashboard" element={<CustomerDashboard />} />
        <Route path="/customer-ai" element={<CustomerAssistant />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/shop/product/:id" element={<ProductDetail />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order-success/:id" element={<OrderSuccess />} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/my-orders/:id" element={<OrderDetails />} />
        <Route path="/track-order/:id" element={<TrackOrder />} />
        <Route path="/my-invoices" element={<MyInvoices />} />
        <Route path="/my-payments" element={<MyPayments />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/notifications" element={<CustomerNotifications />} />

        {/* legacy customer routes kept working */}
        <Route path="/products" element={<Shop />} />
        <Route path="/orders/:id" element={<OrderDetails />} />
        <Route path="/orders/:id/invoice" element={<InvoicePage />} />
        <Route path="/invoice/:orderId" element={<InvoicePage />} />
      </Route>

      {/* ADMIN ROUTES */}
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="products" element={<AdminProducts />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="billing" element={<AdminBilling />} />

        {/* DMS Master */}
        <Route path="categories" element={<AdminCategories />} />
        <Route path="brands" element={<AdminBrands />} />
        <Route path="suppliers" element={<AdminSuppliers />} />
        <Route path="retailers" element={<AdminRetailers />} />

        {/* DMS Inventory */}
        <Route path="inventory" element={<AdminInventory />} />
        <Route path="stock-in" element={<AdminStockIn />} />
        <Route path="stock-history" element={<AdminStockHistory />} />
        <Route path="low-stock" element={<AdminLowStock />} />
        <Route path="damaged-expired" element={<AdminDamagedExpired />} />

        {/* DMS Advanced - Phases 1-5 */}
        <Route path="sales-management" element={<AdminSalesManagement />} />
        <Route path="territories" element={<AdminTerritories />} />
        <Route path="purchase-orders" element={<AdminPurchaseOrders />} />
        <Route path="returns" element={<AdminReturns />} />

        {/* DMS Sales */}
        <Route path="sales-orders" element={<AdminSalesOrders />} />
        <Route path="order-tracking" element={<AdminOrderTracking />} />
        <Route path="invoices" element={<AdminInvoices />} />
        <Route path="payments" element={<AdminPayments />} />

        {/* Phases 6-9 */}
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="reorder" element={<AdminReorder />} />
        <Route path="global-search" element={<AdminGlobalSearch />} />
        <Route path="activity-logs" element={<AdminActivityLogs />} />
        <Route path="notifications" element={<CustomerNotifications />} />

        {/* Enterprise 2026 */}
        <Route path="assistant" element={<AdminAssistant />} />
        <Route path="profit" element={<AdminProfit />} />
        <Route path="promotions" element={<AdminPromotions />} />
        <Route path="credit" element={<AdminCredit />} />
        <Route path="deliveries" element={<AdminDeliveries />} />
        <Route path="warehouses" element={<AdminWarehouses />} />
        <Route path="barcode" element={<AdminBarcode />} />
        <Route path="routes" element={<AdminRoutes />} />
        <Route path="visits" element={<AdminVisits />} />
        <Route path="security" element={<AdminSecurity />} />
        <Route path="loyalty" element={<AdminLoyalty />} />
        <Route path="companies" element={<AdminCompanies />} />
      </Route>

      {/* FALLBACK */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ToastProvider>
    </MotionConfig>
  );
}
