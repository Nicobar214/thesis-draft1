import { Suspense, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import ProtectedRoute from "./components/ProtectedRoute";
import Logo from "./components/Logo";
import { lazyPage } from "./lib/lazyPage";

// Pages load on demand so a citizen never downloads the admin dashboard.
const AdminAuthPage = lazyPage(() => import("./pages/AdminAuthPage"));
const Dashboard = lazyPage(() => import("./pages/Dashboard"));
const UserDashboard = lazyPage(() => import("./pages/UserDashboard"));
const UserReports = lazyPage(() => import("./pages/UserReports"));
const UserFeedback = lazyPage(() => import("./pages/UserFeedback"));
const UserFMRProjects = lazyPage(() => import("./pages/UserFMRProjects"));
const UserMapView = lazyPage(() => import("./pages/UserMapView"));
const UserProfile = lazyPage(() => import("./pages/UserProfile"));
const UserProjects = lazyPage(() => import("./pages/UserProjects"));
const PublicReportsPage = lazyPage(() => import("./pages/PublicReportsPage"));
const PublicReportPortalPage = lazyPage(() => import("./pages/PublicReportPortalPage"));
const FieldEngineerAuth = lazyPage(() => import("./pages/FieldEngineerAuth"));
const FieldEngineerDashboard = lazyPage(() => import("./pages/FieldEngineerDashboard"));
const ContractorAuth = lazyPage(() => import("./pages/ContractorAuth"));
const ContractorDashboard = lazyPage(() => import("./pages/ContractorDashboard"));
const ContractorProjects = lazyPage(() => import("./pages/ContractorProjects"));
const ContractorReports = lazyPage(() => import("./pages/ContractorReports"));
const LguAuth = lazyPage(() => import("./pages/LguAuth"));
const LguDashboard = lazyPage(() => import("./pages/LguDashboard"));
const FarmerAuth = lazyPage(() => import("./pages/FarmerAuth"));
const FarmerDashboard = lazyPage(() => import("./pages/FarmerDashboard"));

import PWAInstallBanner from "./components/PWAInstallBanner";
import ToastViewport from "./components/ToastViewport";
import ConfirmDialogHost from "./components/ConfirmDialogHost";
import { triggerQueuedSync } from "./lib/offlineSync";

function PageLoading() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <Logo className="h-10 mx-auto mb-6" />
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-700 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    const handleOnline = () => {
      console.info('[offline-sync] Online event');
      triggerQueuedSync();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        console.info('[offline-sync] Visible while online');
        triggerQueuedSync();
      }
    };
    if (navigator.onLine) {
      handleOnline();
    }
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return (
    <Router>
      <PWAInstallBanner />
      <ToastViewport />
      <ConfirmDialogHost />
      <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* ===== USER SIDE (with landing page) ===== */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/signin" element={<AuthPage mode="signin" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/report-portal" element={<PublicReportPortalPage />} />
        <Route path="/reports" element={<PublicReportsPage />} />
        <Route path="/user" element={
          <ProtectedRoute requiredRole="user">
            <UserDashboard />
          </ProtectedRoute>
        } />
        <Route path="/user/reports" element={
          <ProtectedRoute requiredRole="user">
            <UserReports />
          </ProtectedRoute>
        } />
        <Route path="/user/feedback" element={
          <ProtectedRoute requiredRole="user">
            <UserFeedback />
          </ProtectedRoute>
        } />
        <Route path="/user/projects" element={
          <ProtectedRoute requiredRole="user">
            <UserProjects />
          </ProtectedRoute>
        } />
        <Route path="/user/fmr-projects" element={
          <ProtectedRoute requiredRole="user">
            <UserFMRProjects />
          </ProtectedRoute>
        } />
        <Route path="/user/map" element={
          <ProtectedRoute requiredRole="user">
            <UserMapView />
          </ProtectedRoute>
        } />
        <Route path="/user/profile" element={
          <ProtectedRoute requiredRole="user">
            <UserProfile />
          </ProtectedRoute>
        } />

        {/* ===== FIELD ENGINEER SIDE ===== */}
        <Route path="/field-engineer/login" element={<FieldEngineerAuth />} />
        <Route path="/field-engineer" element={
          <ProtectedRoute requiredRole="field_engineer">
            <FieldEngineerDashboard />
          </ProtectedRoute>
        } />

        {/* ===== CONTRACTOR SIDE ===== */}
        <Route path="/contractor/login" element={<ContractorAuth />} />
        <Route path="/contractor" element={
          <ProtectedRoute requiredRole="contractor">
            <ContractorDashboard />
          </ProtectedRoute>
        } />
        <Route path="/contractor/projects" element={
          <ProtectedRoute requiredRole="contractor">
            <ContractorProjects />
          </ProtectedRoute>
        } />
        <Route path="/contractor/reports" element={
          <ProtectedRoute requiredRole="contractor">
            <ContractorReports />
          </ProtectedRoute>
        } />

        {/* ===== LGU SIDE ===== */}
        <Route path="/lgu/login" element={<LguAuth />} />
        <Route path="/lgu" element={
          <ProtectedRoute requiredRole="lgu">
            <LguDashboard />
          </ProtectedRoute>
        } />

        {/* ===== FARMER SIDE ===== */}
        <Route path="/farmer/login" element={<FarmerAuth />} />
        <Route path="/farmer" element={
          <ProtectedRoute requiredRole="farmer">
            <FarmerDashboard />
          </ProtectedRoute>
        } />

        {/* ===== ADMIN SIDE (no landing page, direct login) ===== */}
        <Route path="/admin" element={<AdminAuthPage />} />
        <Route path="/dashboard" element={
          <ProtectedRoute requiredRole="admin">
            <Dashboard />
          </ProtectedRoute>
        } />
      </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
