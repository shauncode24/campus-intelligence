import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Spinner from "../components/Loading/Spinner";

// Lazy load all pages
const Homepage = lazy(() => import("../pages/Homepage"));
const AdminLogin = lazy(() => import("../pages/AdminLogin"));
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
          <Route path="/" element={<Homepage />} />
          <Route path="/login" element={<AdminLogin />} />
          <Route path="/admin/add-document" element={<AddDocument />} />
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/saved-answers" element={<SavedAnswers />} />
          <Route path="/documents" element={<DocumentLibrary />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/calendar/success" element={<CalendarCallback />} />
          <Route path="/calendar/error" element={<CalendarCallback />} />
          <Route path="/admin/documents" element={<DocumentManagement />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
