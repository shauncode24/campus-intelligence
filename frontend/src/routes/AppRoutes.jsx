import { BrowserRouter, Routes, Route } from "react-router-dom";
import AdminLogin from "../pages/AdminLogin";
import AddDocument from "../pages/AddDocument";
import StudentDashboard from "../pages/StudentDashboard";
import Homepage from "../pages/Homepage";
import FAQPage from "../pages/FAQPage";
import HistoryPage from "../pages/HistoryPage";
import CalendarCallback from "../pages/CalendarCallback";
import DocumentManagement from "../pages/DocumentManagement";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Homepage />} />
        <Route path="/login" element={<AdminLogin />} />
        <Route path="/admin/add-document" element={<AddDocument />} />
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/calendar/success" element={<CalendarCallback />} />
        <Route path="/calendar/error" element={<CalendarCallback />} />
        <Route path="/admin/documents" element={<DocumentManagement />} />
      </Routes>
    </BrowserRouter>
  );
}
