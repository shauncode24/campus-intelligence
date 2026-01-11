import { useState } from "react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
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
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const login = async () => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast.success("Admin access granted");
      navigate("/admin/add-document");
    } catch (err) {
      handleError(err, {
        customMessage: "Login failed. Please check your credentials.",
      });
    } finally {
      setLoading(false);
    }
  };

  /* ✅ EMAIL CONFIRMATION BEFORE RESET */
  const handlePasswordReset = async () => {
    if (!email) {
      toast.error("Please enter your email first");
      return;
    }

    const confirmed = window.confirm(
      `Send a password reset link to:\n\n${email}?`
    );

    if (!confirmed) return;

    try {
      await sendPasswordResetEmail(auth, email);
      toast.success("Password reset email sent");
    } catch (err) {
      handleError(err, {
        customMessage: "Failed to send password reset email",
      });
    }
  };

  return (
    <div className="admin-login-container">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <div className="admin-login-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="36"
              height="36"
              fill="white"
              viewBox="0 0 16 16"
            >
              <path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0-1 1v2h3v-2a1 1 0 0 0-1-1V6.739l.686-.275a.5.5 0 0 0 .025-.917z" />
            </svg>
          </div>

          <h1 className="admin-login-title">Admin Portal</h1>
          <p className="admin-login-subtitle">
            Secure access for university administrators
          </p>
        </div>

        <div className="admin-login-form">
          <div className="admin-form-group">
            <label>Email Address</label>
            <input
              type="email"
              placeholder="admin@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="admin-form-group">
            <label>Password</label>
            <div className="password-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    fill="#1a73e8"
                    class="bi bi-eye-slash"
                    viewBox="0 0 16 16"
                    stroke="#1a73e8"
                    strokeWidth={0.2}
                  >
                    <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z" />
                    <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829" />
                    <path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    fill="#1a73e8"
                    class="bi bi-eye"
                    viewBox="0 0 16 16"
                    stroke="#1a73e8"
                    strokeWidth={0.2}
                  >
                    <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z" />
                    <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            className="admin-signin-button"
            onClick={login}
            disabled={loading || !email || !password}
          >
            {loading ? "Verifying Access..." : "Sign In"}
          </button>
        </div>

        <div className="admin-footer">
          <button
            type="button"
            className="admin-forgot-link"
            onClick={handlePasswordReset}
          >
            Forgot password?
          </button>

          <p className="admin-security-note">
            This system is restricted to authorized personnel only.
          </p>
        </div>
      </div>
    </div>
  );
}
