import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./CalendarCallback.css";
import { usePageTitle } from "../components/usePageTitle";

export default function CalendarCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading"); // 'loading' | 'success' | 'error'

  useEffect(() => {
    // Check if this is success or error page
    if (location.pathname.includes("/calendar/success")) {
      setStatus("success");

      // Auto-close popup after 3 seconds if in popup
      if (window.opener) {
        setTimeout(() => {
          window.close();
        }, 3000);
      } else {
        // If not in popup, redirect to dashboard after 3 seconds
        setTimeout(() => {
          navigate("/student");
        }, 3000);
      }
    } else if (location.pathname.includes("/calendar/error")) {
      setStatus("error");

      // Auto-close popup after 5 seconds if in popup
      if (window.opener) {
        setTimeout(() => {
          window.close();
        }, 5000);
      } else {
        // If not in popup, redirect to dashboard after 5 seconds
        setTimeout(() => {
          navigate("/student");
        }, 5000);
      }
    }
  }, [location, navigate]);

  const handleClose = () => {
    if (window.opener) {
      window.close();
    } else {
      navigate("/student");
    }
  };

  if (status === "loading") {
    return (
      <div className="calendar-callback-container">
        <div className="callback-card">
          <div className="spinner-large"></div>
          <h2>Processing authorization...</h2>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="calendar-callback-container">
        <div className="callback-card success">
          <div className="success-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="64"
              height="64"
              fill="#34a853"
              viewBox="0 0 16 16"
            >
              <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z" />
            </svg>
          </div>

          <h1>Calendar Connected!</h1>
          <p>Your Google Calendar has been successfully connected.</p>
          <p className="small-text">
            You can now add deadline reminders with one click.
          </p>

          <button className="callback-button" onClick={handleClose}>
            {window.opener ? "Close this window" : "Return to Dashboard"}
          </button>

          {window.opener && (
            <p className="auto-close-text">
              This window will close automatically in 3 seconds...
            </p>
          )}
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="calendar-callback-container">
        <div className="callback-card error">
          <div className="error-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="64"
              height="64"
              fill="#ea4335"
              viewBox="0 0 16 16"
            >
              <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />
            </svg>
          </div>

          <h1>Connection Failed</h1>
          <p>There was a problem connecting your Google Calendar.</p>
          <p className="small-text">
            Please try again or contact support if the issue persists.
          </p>

          <button className="callback-button" onClick={handleClose}>
            {window.opener ? "Close this window" : "Return to Dashboard"}
          </button>

          {window.opener && (
            <p className="auto-close-text">
              This window will close automatically in 5 seconds...
            </p>
          )}
        </div>
      </div>
    );
  }

  return null;
}
