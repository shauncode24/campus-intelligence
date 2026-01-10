import { useState, useRef, useEffect } from "react";
import "../styles/ChatInput.css";
import { useApp } from "../contexts/AppContext";

export default function ChatInput({ onSendMessage, loading, sidebarOpen }) {
  const [input, setInput] = useState("");
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim() || loading) return;
    onSendMessage(input);
    setInput("");
  };

  const handleClear = () => {
    setInput("");
    textareaRef.current?.focus();
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={`default chat-input-container ${
        sidebarOpen ? "sidebar-open" : ""
      }`}
    >
      <div className="default chat-input-wrapper">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="25"
          height="25"
          fill="currentColor"
          className="search-icon"
          viewBox="0 0 16 16"
        >
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
        </svg>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask a question..."
          className="default chat-textarea"
          rows={1}
        />

        {input.trim() && (
          <button
            onClick={handleClear}
            className="default chat-clear-button"
            type="button"
            aria-label="Clear text"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              class="bi bi-x-lg"
              viewBox="0 0 16 16"
              stroke="currentColor"
              strokeWidth="1"
            >
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
            </svg>
          </button>
        )}

        <button
          onClick={handleSubmit}
          disabled={!input.trim() || loading}
          className={`chat-submit-button ${
            input.trim() && !loading ? "active" : ""
          }`}
        >
          {loading ? "..." : "Ask"}
        </button>
      </div>
    </div>
  );
}
