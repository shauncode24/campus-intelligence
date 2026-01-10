import { useState } from "react";
import "./CalendarButton.css";
import { FcGoogle } from "react-icons/fc";
const { VITE_API_BASE_URL } = import.meta.env;
import toast from "react-hot-toast";
import { lazy, Suspense } from "react";
const CalendarPreviewModal = lazy(() => import("./CalendarPreviewModal"));
import { handleError } from "../utils/errors";
import Spinner from "../components/Loading/Spinner";
const preloadModal = () => {
  import("./CalendarPreviewModal");
};

export default function CalendarButton({ deadline, userId, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [select, setSelect] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleSelect = () => {
    setSelect(!select);
  };

  const handleConnect = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get auth URL from backend
      const response = await fetch(
        `${VITE_API_BASE_URL}/calendar/auth?userId=${userId}`
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
      handleError(err, {
        customMessage: "Failed to connect to Google Calendar",
      });
    } finally {
      setLoading(false);
    }
  };

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch(
        `${VITE_API_BASE_URL}/calendar/status?userId=${userId}`
      );
      const data = await response.json();
      setConnected(data.connected);
    } catch (err) {
      handleError(err, { silent: true });
    }
  };

  const handleAddToCalendar = async () => {
    setShowPreview(false);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${VITE_API_BASE_URL}/calendar/create-event`,
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
        toast.success("Event added to your Google Calendar!");
        setSelect(false);
      } else {
        handleError(new Error(data.message), { customMessage: data.message });
      }
    } catch (err) {
      handleError(err, { customMessage: "Failed to add event to calendar" });
    } finally {
      setLoading(false);
    }
  };

  if (!deadline || !deadline.canAddToCalendar) {
    return null;
  }

  return (
    <>
      <div style={{ position: "relative" }}>
        <div
          className={`default show-calendar-button ${select ? "select" : ""}`}
          onClick={handleSelect}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            fill="currentColor"
            class="bi bi-calendar-plus"
            viewBox="0 0 16 16"
          >
            <path d="M8 7a.5.5 0 0 1 .5.5V9H10a.5.5 0 0 1 0 1H8.5v1.5a.5.5 0 0 1-1 0V10H6a.5.5 0 0 1 0-1h1.5V7.5A.5.5 0 0 1 8 7" />
            <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z" />
          </svg>
          Add event
        </div>

        <div
          className={`default calendar-button-container ${
            select ? "open" : ""
          }`}
        >
          <div className="default calendar-button-container-top">
            <div className="default calendar-button-container-top-icon">
              {" "}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="#D97706"
                viewBox="0 0 16 16"
              >
                <path d="M11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z" />
                <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z" />
              </svg>
            </div>
            <div className="default calendar-button-container-top-content">
              <div className="default calendar-button-container-top-content-header">
                EVENT DATE
              </div>
              <div className="default calendar-button-container-top-content-body">
                {new Date(deadline.date).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
          </div>
          <div className="default calendar-button-container-bottom">
            {!connected ? (
              <button
                className="default calendar-button connect-button"
                onClick={handleConnect}
                disabled={loading}
              >
                <FcGoogle size={18} />
                {loading ? (
                  <>
                    <Spinner size="sm" color="white" />
                    <span style={{ marginLeft: "8px" }}>Connecting...</span>
                  </>
                ) : (
                  "Connect to Google Calendar"
                )}
              </button>
            ) : (
              <>
                <button
                  className="default calendar-button add-button"
                  onClick={() => setShowPreview(true)}
                  onMouseEnter={preloadModal}
                  onFocus={preloadModal}
                  disabled={loading}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    fill="currentColor"
                    class="bi bi-plus-lg"
                    viewBox="0 0 16 16"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2"
                    />
                  </svg>
                  Preview & Add to Calendar
                </button>
                {showPreview && (
                  <Suspense fallback={<Spinner size="sm" />}>
                    <CalendarPreviewModal
                      isOpen={showPreview}
                      onClose={() => setShowPreview(false)}
                      onConfirm={handleAddToCalendar}
                      eventData={{
                        title: deadline.title,
                        date: deadline.date,
                        description: deadline.description || deadline.context,
                        sourceDocument:
                          deadline.sourceDocument || "Campus Documents",
                      }}
                      loading={loading}
                    />
                  </Suspense>
                )}
              </>
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
        </div>
      </div>
    </>
  );
}
