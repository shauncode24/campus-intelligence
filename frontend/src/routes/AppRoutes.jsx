import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "../auth/Login";
import AdminDashboard from "../dashboards/AdminDashboard";
import StudentDashboard from "../pages/StudentDashboard";
import Homepage from "../pages/Homepage";
import FAQPage from "../pages/FAQPage";
import HistoryPage from "../pages/HistoryPage";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Homepage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/history" element={<HistoryPage />} />
      </Routes>
    </BrowserRouter>
  );
}
