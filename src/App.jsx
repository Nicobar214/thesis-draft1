import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import AdminAuthPage from "./pages/AdminAuthPage";
import Dashboard from "./pages/Dashboard";
import UserDashboard from "./pages/UserDashboard";
import UserProjects from "./pages/UserProjects";
import UserReports from "./pages/UserReports";
import UserFeedback from "./pages/UserFeedback";
import PublicReportsPage from "./pages/PublicReportsPage";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <Router>
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
        <Route path="/user/projects" element={
          <ProtectedRoute requiredRole="user">
            <UserProjects />
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

        {/* ===== ADMIN SIDE (no landing page, direct login) ===== */}
        <Route path="/admin" element={<AdminAuthPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
