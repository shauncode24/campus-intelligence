import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "../auth/Login";
import AdminDashboard from "../dashboards/AdminDashboard";
import StudentDashboard from "../dashboards/StudentDashboard";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/student" element={<StudentDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
