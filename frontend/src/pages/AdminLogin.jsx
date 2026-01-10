import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../app/firebase";
import { useNavigate } from "react-router-dom";
import "./AdminLogin.css";
import toast from "react-hot-toast";
import { usePageTitle } from "../components/usePageTitle";
import { handleError } from "../utils/errors";

export default function AdminLogin() {
  usePageTitle("Admin Login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const login = async () => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);

      // TEMP ROLE LOGIC (PHASE 2 ONLY)
      if (email === "admin@test.com") {
        navigate("/admin/add-document");
      } else {
        navigate("/student");
      }
    } catch (err) {
      handleError(err, {
        customMessage: "Login failed. Please check your credentials.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      login();
    }
  };

  return (
    <div className="admin-login-container">
      <div className="admin-login-card">
        <div className="admin-login-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            fill="white"
            viewBox="0 0 16 16"
          >
            <path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0-1 1v2h3v-2a1 1 0 0 0-1-1V6.739l.686-.275a.5.5 0 0 0 .025-.917z" />
            <path d="M4.176 9.032a.5.5 0 0 0-.656.327l-.5 1.7a.5.5 0 0 0 .294.605l4.5 1.8a.5.5 0 0 0 .372 0l4.5-1.8a.5.5 0 0 0 .294-.605l-.5-1.7a.5.5 0 0 0-.656-.327L8 10.466z" />
          </svg>
        </div>

        <h1 className="admin-login-title">Admin Portal</h1>
        <p className="admin-login-subtitle">
          Sign in to manage documents and view analytics
        </p>

        <div className="admin-login-form">
          <div className="admin-form-group">
            <label htmlFor="email" className="admin-form-label">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              className="admin-form-input"
              placeholder="admin@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
            />
          </div>

          <div className="admin-form-group">
            <label htmlFor="password" className="admin-form-label">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="admin-form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
            />
          </div>

          <button
            className="admin-signin-button"
            onClick={login}
            disabled={loading || !email || !password}
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>
        </div>

        <p className="admin-forgot-password">
          Forgot your password?{" "}
          <a href="#" className="admin-support-link">
            Contact IT Support
          </a>
        </p>
      </div>
    </div>
  );
}
