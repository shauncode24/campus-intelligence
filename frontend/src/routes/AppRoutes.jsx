import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Spinner from "../components/Loading/Spinner";
import ProtectedRoute from "../components/ProtectedRoute";

// Lazy load all pages
const Homepage = lazy(() => import("../pages/Homepage"));
const AdminLogin = lazy(() => import("../pages/AdminLogin"));
const UserLogin = lazy(() => import("../pages/UserLogin"));
const AddDocument = lazy(() => import("../pages/AddDocument"));
const StudentDashboard = lazy(() => import("../pages/StudentDashboard"));
const FAQPage = lazy(() => import("../pages/FAQPage"));
const HistoryPage = lazy(() => import("../pages/HistoryPage"));
const CalendarCallback = lazy(() => import("../pages/CalendarCallback"));
const DocumentManagement = lazy(() => import("../pages/DocumentManagement"));
const DocumentLibrary = lazy(() => import("../pages/DocumentLibrary"));
const SavedAnswers = lazy(() => import("../pages/SavedAnswer"));

const PageLoader = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
    }}
  >
    <Spinner size="lg" />
  </div>
);

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Homepage />} />
          <Route path="/login" element={<AdminLogin />} />
          <Route path="/user-login" element={<UserLogin />} />
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/documents" element={<DocumentLibrary />} />
          <Route path="/calendar/success" element={<CalendarCallback />} />
          <Route path="/calendar/error" element={<CalendarCallback />} />

          {/* Protected user routes - require login */}
          <Route
            path="/history"
            element={
              <ProtectedRoute requireAuth={true}>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/saved-answers"
            element={
              <ProtectedRoute requireAuth={true}>
                <SavedAnswers />
              </ProtectedRoute>
            }
          />

          {/* Admin routes */}
          <Route path="/admin/add-document" element={<AddDocument />} />
          <Route path="/admin/documents" element={<DocumentManagement />} />

          {/* Catch all - redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
