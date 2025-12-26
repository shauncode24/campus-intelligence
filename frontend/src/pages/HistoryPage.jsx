import { useState, useEffect } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import "./HistoryPage.css";

export default function HistoryPage() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");

  useEffect(() => {
    // Get or create user ID from localStorage
    let storedUserId = localStorage.getItem("campus_intel_user_id");
    if (!storedUserId) {
      storedUserId = `user_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      localStorage.setItem("campus_intel_user_id", storedUserId);
    }
    setUserId(storedUserId);
    fetchHistory(storedUserId);
  }, []);

  const fetchHistory = async (uid) => {
    try {
      const response = await fetch(
        `${VITE_API_BASE_URL}/history/${uid}?limit=50`
      );
      const data = await response.json();
      setHistory(data.history);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching history:", error);
      setLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown date";

    // Handle Firestore Timestamp object
    let date;
    if (timestamp.toDate && typeof timestamp.toDate === "function") {
      date = timestamp.toDate();
    } else if (timestamp._seconds) {
      // Firestore Timestamp has _seconds property
      date = new Date(timestamp._seconds * 1000);
    } else if (timestamp.seconds) {
      // Alternative Timestamp format
      date = new Date(timestamp.seconds * 1000);
    } else {
      date = new Date(timestamp);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return "Unknown date";
    }

    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMinutes = Math.floor(diffTime / (1000 * 60));
        return diffMinutes === 0
          ? "Just now"
          : `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
      }
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    }

    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="history-loading">
          <div className="loading-spinner"></div>
          <p>Loading your question history...</p>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="history-container">
        <div className="history-header">
          <h1 className="history-title">Your Question History</h1>
          <p className="history-subtitle">
            View all your previous questions and answers in one place
          </p>
        </div>

        {history.length === 0 ? (
          <div className="history-empty">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="64"
              height="64"
              fill="#dadce0"
              viewBox="0 0 16 16"
            >
              <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783" />
            </svg>
            <h2>No questions asked yet</h2>
            <p>Start asking questions to build your history!</p>
          </div>
        ) : (
          <div className="history-timeline">
            {history.map((item, index) => (
              <div key={item.id} className="history-item">
                <div className="history-timestamp">
                  {formatDate(item.askedAt)}
                </div>
                <div className="history-card">
                  <div className="history-question">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      fill="#5f6368"
                      viewBox="0 0 16 16"
                    >
                      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
                      <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94" />
                    </svg>
                    <p>{item.questionText}</p>
                  </div>
                  <div className="history-answer">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      fill="#4285f4"
                      viewBox="0 0 16 16"
                    >
                      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2" />
                    </svg>
                    <p>{item.answer}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}
