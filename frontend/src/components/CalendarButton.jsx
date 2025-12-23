import { useState } from "react";
import "./CalendarButton.css";

export default function CalendarButton({ deadline, userId, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get auth URL from backend
      const response = await fetch(
        `http://localhost:5000/calendar/auth?userId=${userId}`
      );
      const data = await response.json();

      if (data.authUrl) {
        // Open Google OAuth in popup
        const width = 500;
        const height = 600;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        const popup = window.open(
          data.authUrl,
          "Google Calendar Authorization",
          `width=${width},height=${height},left=${left},top=${top}`
        );

        // Listen for popup close
        const checkPopup = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopup);
            // Check connection status
            checkConnectionStatus();
          }
        }, 1000);
      }
    } catch (err) {
      console.error("Connection error:", err);
      setError("Failed to connect to Google Calendar");
    } finally {
      setLoading(false);
    }
  };

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch(
        `http://localhost:5000/calendar/status?userId=${userId}`
      );
      const data = await response.json();
      setConnected(data.connected);
    } catch (err) {
      console.error("Status check error:", err);
    }
  };

  const handleAddToCalendar = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "http://localhost:5000/calendar/create-event",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            eventData: {
              title: deadline.title,
              date: deadline.date,
              description: deadline.description || deadline.context,
              sourceDocument: deadline.sourceDocument || "Campus Documents",
            },
          }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        if (onSuccess) {
          onSuccess(data.event);
        }
        alert("✅ Event added to your Google Calendar!");
      } else {
        if (data.error === "Not authorized" || data.error === "Token expired") {
          setConnected(false);
          setError(data.message);
        } else {
          setError(data.message || "Failed to create event");
        }
      }
    } catch (err) {
      console.error("Create event error:", err);
      setError("Failed to add event to calendar");
    } finally {
      setLoading(false);
    }
  };

  if (!deadline || !deadline.canAddToCalendar) {
    return null;
  }

  return (
    <div className="calendar-button-container">
      <div className="deadline-info">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          fill="#ea4335"
          viewBox="0 0 16 16"
        >
          <path d="M11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z" />
          <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z" />
        </svg>
        <div className="deadline-details">
          <div className="deadline-title">{deadline.title}</div>
          <div className="deadline-date">
            {new Date(deadline.date).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </div>

      {!connected ? (
        <button
          className="calendar-button connect-button"
          onClick={handleConnect}
          disabled={loading}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M15.545 6.558a9.4 9.4 0 0 1 .139 1.626c0 2.434-.87 4.492-2.384 5.885h.002C11.978 15.292 10.158 16 8 16A8 8 0 1 1 8 0a7.7 7.7 0 0 1 5.352 2.082l-2.284 2.284A4.35 4.35 0 0 0 8 3.166c-2.087 0-3.86 1.408-4.492 3.304a4.8 4.8 0 0 0 0 3.063h.003c.635 1.893 2.405 3.301 4.492 3.301 1.078 0 2.004-.276 2.722-.764h-.003a3.7 3.7 0 0 0 1.599-2.431H8v-3.08z" />
          </svg>
          {loading ? "Connecting..." : "Connect Google Calendar"}
        </button>
      ) : (
        <button
          className="calendar-button add-button"
          onClick={handleAddToCalendar}
          disabled={loading}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4" />
          </svg>
          {loading ? "Adding..." : "Add to Google Calendar"}
        </button>
      )}

      {error && (
        <div className="calendar-error">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
