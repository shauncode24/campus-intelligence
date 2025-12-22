import { useState, useEffect } from "react";
import "../styles/Chat.css";

export default function Chat({ onMessagesChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

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

    const res = await fetch("http://localhost:5000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: input }),
    });

    const data = await res.json();

    const botMessage = {
      role: "bot",
      text: data.answer,
    };

    setMessages((prev) => [...prev, botMessage]);
    setInput("");
    setLoading(false);
  };

  return (
    <>
      <div
        className={`default response-main-div ${!messages ? "messages" : ""}`}
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
              {m.role === "user" ? "You" : "AI"}:
            </b>{" "}
            <span
              className={`default ${
                m.role === "user" ? "message-you" : "message-ai"
              }`}
            >
              {m.text}
            </span>
          </p>
        ))}
        {loading && <p>Thinking...</p>}
      </div>

      <div className="default chat-main-div">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="25"
          height="25"
          fill="currentColor"
          class="bi bi-search"
          viewBox="0 0 16 16"
        >
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
        </svg>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          className="default chat-input"
        />
        <button
          onClick={sendMessage}
          className={`default chat-button ${input ? "active" : ""}`}
        >
          Ask
        </button>
      </div>
    </>
  );
}
