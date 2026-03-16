import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import AdminAuthPage from "./pages/AdminAuthPage";
import Dashboard from "./pages/Dashboard";
import UserDashboard from "./pages/UserDashboard";
import UserReports from "./pages/UserReports";
import UserFeedback from "./pages/UserFeedback";
import UserFMRProjects from "./pages/UserFMRProjects";
import UserMapView from "./pages/UserMapView";
import UserProfile from "./pages/UserProfile";
import UserProjects from "./pages/UserProjects";
import PublicReportsPage from "./pages/PublicReportsPage";
import ProtectedRoute from "./components/ProtectedRoute";
import FieldEngineerAuth from "./pages/FieldEngineerAuth";
import FieldEngineerDashboard from "./pages/FieldEngineerDashboard";
import ContractorAuth from "./pages/ContractorAuth";
import ContractorDashboard from "./pages/ContractorDashboard";
import ContractorProjects from "./pages/ContractorProjects";
import ContractorReports from "./pages/ContractorReports";
import LguAuth from "./pages/LguAuth";
import LguDashboard from "./pages/LguDashboard";
import PWAInstallBanner from "./components/PWAInstallBanner";

function App() {
  return (
    <Router>
      <PWAInstallBanner />
      <Routes>
        {/* ===== USER SIDE (with landing page) ===== */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/signin" element={<AuthPage mode="signin" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
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

        {/* ===== ADMIN SIDE (no landing page, direct login) ===== */}
        <Route path="/admin" element={<AdminAuthPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
