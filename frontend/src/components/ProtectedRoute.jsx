import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import toast from "react-hot-toast";

export default function ProtectedRoute({ children, requireAuth = true }) {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div className="spinner"></div>
      </div>
    );
  }

  if (requireAuth && !isLoggedIn) {
    toast.error("Please sign in to access this feature");
    return <Navigate to="/user-login" replace />;
  }

  return children;
}
