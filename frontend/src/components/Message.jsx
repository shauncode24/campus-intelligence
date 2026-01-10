import { useState } from "react";
import CalendarButton from "./CalendarButton";
import SourcesList from "./SourcesList";
import "../styles/Message.css";
import {
  parseTimestamp,
  validateConfidence,
  validateSources,
} from "../utils/validation";
const { VITE_API_BASE_URL, VITE_PYTHON_RAG_URL } = import.meta.env;

export default function Message({ message, userId, isStreaming }) {
  const m = message;
  const [copied, setCopied] = useState(false);
  const [thumbsUp, setThumbsUp] = useState(false);
  const [thumbsDown, setThumbsDown] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(m.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleThumbsUp = () => {
    setThumbsUp(!thumbsUp);
    if (thumbsDown) setThumbsDown(false);
    console.log("Thumbs up feedback:", !thumbsUp);
  };

  const handleThumbsDown = () => {
    setThumbsDown(!thumbsDown);
    if (thumbsUp) setThumbsUp(false);
    console.log("Thumbs down feedback:", !thumbsDown);
  };

  const formatTimestamp = (timestamp) => {
    const date = parseTimestamp(timestamp);
    if (!date) return "Just now";

    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffMins = Math.floor(diffTime / 60000);
    const diffHours = Math.floor(diffTime / 3600000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const handleSave = async () => {
    try {
      // Get the message data from props
      const historyId = m.historyId; // You'll need to pass this from parent

      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/history/user/${userId}/question/${historyId}/favorite`,
        { method: "PUT" }
      );

      if (response.ok) {
        const data = await response.json();
        setSaved(data.favorite);
        console.log("Favorite status updated:", data.favorite);
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
    }
  };

  const handleExport = () => {
    const blob = new Blob([m.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `response-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: "AI Response",
        text: m.text,
      });
    } else {
      handleCopy();
    }
  };

  const getConfidenceColor = (level) => {
    if (!level) return "#5f6368";
    if (level === "High") return "#22C55E";
    if (level === "Medium") return "#fbbc04";
    return "#DC2626";
  };

  if (m.role === "user") {
    return (
      <div className="user-message-wrapper">
        <div className="user-message-container">
          <div className="user-message-header">
            <span className="user-label">You</span>
            <span className="user-timestamp">
              {m.timestamp ? formatTimestamp(m.timestamp) : "Just now"}
            </span>{" "}
          </div>
          <div className="user-message-content">
            <div className="user-message-bubble">{m.text}</div>
            <div className="user-avatar">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                fill="white"
                class="bi bi-person"
                viewBox="0 0 16 16"
              >
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-wrapper message-wrapper-ai">
      <div className="ai-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          fill="white"
          viewBox="0 0 16 16"
        >
          <path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z" />
        </svg>
      </div>

      <div className="message-container message-container-ai">
        <div className="message-content">
          <div className="message-bubble bubble-ai">
            {!isStreaming &&
              m.confidence &&
              validateConfidence(m.confidence) && (
                <div className="top-section">
                  <div
                    className="confidence-badge-top"
                    style={{ color: getConfidenceColor(m.confidence.level) }}
                  >
                    <div
                      className="default badge-div"
                      style={{
                        backgroundColor: getConfidenceColor(m.confidence.level),
                      }}
                    ></div>
                    <span className="confidence-text">
                      {m.confidence.level} confidence &nbsp;
                    </span>
                    <span className="confidence-percentage">
                      {m.confidence.score}%
                    </span>
                  </div>

                  <div className="document-badge">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      fill="currentColor"
                      className="bi bi-file-earmark-arrow-up"
                      viewBox="0 0 16 16"
                    >
                      <path d="M8.5 11.5a.5.5 0 0 1-1 0V7.707L6.354 8.854a.5.5 0 1 1-.708-.708l2-2a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 7.707z" />
                      <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2M9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z" />
                    </svg>
                    Based on documents uploaded on Dec 21, 2024
                  </div>
                </div>
              )}

            <div className="message-text-content">
              {m.text}
              {isStreaming && <span className="streaming-cursor">▊</span>}
            </div>

            {!isStreaming && m.role === "bot" && m.deadline && (
              <div className="message-calendar-container">
                <CalendarButton
                  deadline={m.deadline}
                  userId={userId}
                  onSuccess={(event) => {
                    console.log("Event created:", event);
                  }}
                />
              </div>
            )}
          </div>

          {!isStreaming && m.sources && m.sources.length > 0 && (
            <SourcesList sources={m.sources} />
          )}
        </div>

        {!isStreaming && (
          <div className="message-actions-bar">
            <button
              className={`icon-btn-msg ${copied ? "active" : ""}`}
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy"}
            >
              {copied ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  fill="currentColor"
                  class="bi bi-copy"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth="0.6"
                >
                  <path
                    fill-rule="evenodd"
                    d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"
                  />
                </svg>
              )}
            </button>

            <button
              className={`icon-btn-msg ${thumbsUp ? "active" : ""}`}
              onClick={handleThumbsUp}
              title="Good response"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                fill="currentColor"
                class="bi bi-copy"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth="0.6"
              >
                <path d="M8.864.046C7.908-.193 7.02.53 6.956 1.466c-.072 1.051-.23 2.016-.428 2.59-.125.36-.479 1.013-1.04 1.639-.557.623-1.282 1.178-2.131 1.41C2.685 7.288 2 7.87 2 8.72v4.001c0 .845.682 1.464 1.448 1.545 1.07.114 1.564.415 2.068.723l.048.03c.272.165.578.348.97.484.397.136.861.217 1.466.217h3.5c.937 0 1.599-.477 1.934-1.064a1.86 1.86 0 0 0 .254-.912c0-.152-.023-.312-.077-.464.201-.263.38-.578.488-.901.11-.33.172-.762.004-1.149.069-.13.12-.269.159-.403.077-.27.113-.568.113-.857 0-.288-.036-.585-.113-.856a2 2 0 0 0-.138-.362 1.9 1.9 0 0 0 .234-1.734c-.206-.592-.682-1.1-1.2-1.272-.847-.282-1.803-.276-2.516-.211a10 10 0 0 0-.443.05 9.4 9.4 0 0 0-.062-4.509A1.38 1.38 0 0 0 9.125.111zM11.5 14.721H8c-.51 0-.863-.069-1.14-.164-.281-.097-.506-.228-.776-.393l-.04-.024c-.555-.339-1.198-.731-2.49-.868-.333-.036-.554-.29-.554-.55V8.72c0-.254.226-.543.62-.65 1.095-.3 1.977-.996 2.614-1.708.635-.71 1.064-1.475 1.238-1.978.243-.7.407-1.768.482-2.85.025-.362.36-.594.667-.518l.262.066c.16.04.258.143.288.255a8.34 8.34 0 0 1-.145 4.725.5.5 0 0 0 .595.644l.003-.001.014-.003.058-.014a9 9 0 0 1 1.036-.157c.663-.06 1.457-.054 2.11.164.175.058.45.3.57.65.107.308.087.67-.266 1.022l-.353.353.353.354c.043.043.105.141.154.315.048.167.075.37.075.581 0 .212-.027.414-.075.582-.05.174-.111.272-.154.315l-.353.353.353.354c.047.047.109.177.005.488a2.2 2.2 0 0 1-.505.805l-.353.353.353.354c.006.005.041.05.041.17a.9.9 0 0 1-.121.416c-.165.288-.503.56-1.066.56z" />
              </svg>
            </button>

            <button
              className={`icon-btn-msg ${thumbsDown ? "active" : ""}`}
              onClick={handleThumbsDown}
              title="Bad response"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                fill="currentColor"
                class="bi bi-copy"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth="0.6"
              >
                <path d="M8.864 15.674c-.956.24-1.843-.484-1.908-1.42-.072-1.05-.23-2.015-.428-2.59-.125-.36-.479-1.012-1.04-1.638-.557-.624-1.282-1.179-2.131-1.41C2.685 8.432 2 7.85 2 7V3c0-.845.682-1.464 1.448-1.546 1.07-.113 1.564-.415 2.068-.723l.048-.029c.272-.166.578-.349.97-.484C6.931.08 7.395 0 8 0h3.5c.937 0 1.599.478 1.934 1.064.164.287.254.607.254.913 0 .152-.023.312-.077.464.201.262.38.577.488.9.11.33.172.762.004 1.15.069.13.12.268.159.403.077.27.113.567.113.856s-.036.586-.113.856c-.035.12-.08.244-.138.363.394.571.418 1.2.234 1.733-.206.592-.682 1.1-1.2 1.272-.847.283-1.803.276-2.516.211a10 10 0 0 1-.443-.05 9.36 9.36 0 0 1-.062 4.51c-.138.508-.55.848-1.012.964zM11.5 1H8c-.51 0-.863.068-1.14.163-.281.097-.506.229-.776.393l-.04.025c-.555.338-1.198.73-2.49.868-.333.035-.554.29-.554.55V7c0 .255.226.543.62.65 1.095.3 1.977.997 2.614 1.709.635.71 1.064 1.475 1.238 1.977.243.7.407 1.768.482 2.85.025.362.36.595.667.518l.262-.065c.16-.04.258-.144.288-.255a8.34 8.34 0 0 0-.145-4.726.5.5 0 0 1 .595-.643h.003l.014.004.058.013a9 9 0 0 0 1.036.157c.663.06 1.457.054 2.11-.163.175-.059.45-.301.57-.651.107-.308.087-.67-.266-1.021L12.793 7l.353-.354c.043-.042.105-.14.154-.315.048-.167.075-.37.075-.581s-.027-.414-.075-.581c-.05-.174-.111-.273-.154-.315l-.353-.354.353-.354c.047-.047.109-.176.005-.488a2.2 2.2 0 0 0-.505-.804l-.353-.354.353-.354c.006-.005.041-.05.041-.17a.9.9 0 0 0-.121-.415C12.4 1.272 12.063 1 11.5 1" />
              </svg>
            </button>

            <button
              className={`icon-btn-msg ${saved ? "active" : ""}`}
              onClick={handleSave}
              title={saved ? "Saved" : "Save"}
            >
              {saved ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  fill="currentColor"
                  class="bi bi-copy"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth="0.6"
                >
                  <path d="M2 2v13.5a.5.5 0 0 0 .74.439L8 13.069l5.26 2.87A.5.5 0 0 0 14 15.5V2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  fill="currentColor"
                  class="bi bi-copy"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth="0.6"
                >
                  <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
