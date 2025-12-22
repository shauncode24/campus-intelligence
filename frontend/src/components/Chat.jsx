import { useState, useEffect } from "react";
import "../styles/Chat.css";

export default function Chat({ onMessagesChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
  }, []);

  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages.length > 0);
    }
  }, [messages, onMessagesChange]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const res = await fetch("http://localhost:5000/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: input,
          userId: userId,
        }),
      });

      const data = await res.json();

      const botMessage = {
        role: "bot",
        text: data.answer,
        cached: data.cached,
        similarity: data.similarity,
        confidence: data.confidence,
        sources: data.sources || [],
      };

      setMessages((prev) => [...prev, botMessage]);
      setInput("");
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage = {
        role: "bot",
        text: "Sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getConfidenceColor = (level) => {
    if (level === "High") return "#34a853";
    if (level === "Medium") return "#fbbc04";
    return "#ea4335";
  };

  const getConfidenceIcon = (level) => {
    if (level === "High")
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z" />
        </svg>
      );
    if (level === "Medium")
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
          <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z" />
        </svg>
      );
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />
      </svg>
    );
  };

  return (
    <>
      <div
        className={`default response-main-div ${
          !messages.length ? "messages" : ""
        }`}
      >
        {messages.map((m, i) => (
          <p
            key={i}
            className={`default response ${
              m.role === "user" ? "response-you" : "response-ai"
            }`}
          >
            <b
              className={`default ${
                m.role === "user" ? "role-you" : "role-ai"
              }`}
            >
              {m.role === "user" ? "You" : "AI"}
            </b>{" "}
            <span
              className={`default ${
                m.role === "user" ? "message-you" : "message-ai"
              }`}
            >
              {m.text}
            </span>
            {/* Confidence Badge */}
            {m.role === "bot" && m.confidence && (
              <div
                className="default confidence-badge-main"
                style={{
                  border: `2px solid ${getConfidenceColor(m.confidence.level)}`,
                }}
              >
                <span
                  className="default"
                  style={{
                    color: getConfidenceColor(m.confidence.level),
                  }}
                >
                  {getConfidenceIcon(m.confidence.level)}
                </span>
                <span
                  className="default"
                  style={{
                    fontWeight: 600,
                    color: getConfidenceColor(m.confidence.level),
                  }}
                >
                  {m.confidence.level} Confidence
                </span>
                <span className="default" style={{ color: "#5f6368" }}>
                  ({m.confidence.score}%)
                </span>
              </div>
            )}
            {/* Confidence Reasoning */}
            {m.role === "bot" && m.confidence?.reasoning && (
              <div className="default confidence-reasoning-main">
                {m.confidence.reasoning}
              </div>
            )}
            {/* Sources */}
            {m.role === "bot" && m.sources && m.sources.length > 0 && (
              <div className="default sources-main">
                <div className="default sources-main-svg-div">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783" />
                  </svg>
                  Sources
                </div>

                {m.sources.map((source, idx) => (
                  <div className="default source-level-1" key={idx}>
                    <div className="default source-level-2">
                      <div className="default source-level-3">
                        <div className="default source-level-4">
                          {source.documentName}
                        </div>
                        <div className="default source-level-5">
                          Match: {source.similarity}%
                        </div>
                        <div className="default source-level-6">
                          "{source.excerpt}"
                        </div>
                      </div>

                      {source.fileUrl && (
                        <a
                          className="default source-level-7"
                          href={source.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5" />
                            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z" />
                          </svg>
                          Download PDF
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Cache indicator */}
            {m.cached && (
              <p className="default cache-indicator">
                Cached response (similarity: {(m.similarity * 100).toFixed(1)}%)
              </p>
            )}
          </p>
        ))}
        {loading && (
          <div className="default thinking-indicator">
            <div className="thinking-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>

      <div className="default chat-main-div">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="25"
          height="25"
          fill="currentColor"
          className="bi bi-search"
          viewBox="0 0 16 16"
        >
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
        </svg>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask a question..."
          className="default chat-input"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || loading}
          className={`default chat-button ${
            input.trim() && !loading ? "active" : ""
          }`}
        >
          {loading ? "..." : "Ask"}
        </button>
      </div>
    </>
  );
}
