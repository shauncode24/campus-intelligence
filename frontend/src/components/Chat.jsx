import { useState, useEffect, useRef } from "react";
import "../styles/Chat.css";
import CalendarButton from "./CalendarButton";
const { VITE_API_BASE_URL } = import.meta.env;

export default function Chat({ onMessagesChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [sourceSelect, setSourceSelect] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [streamingMetadata, setStreamingMetadata] = useState(null);
  const messagesEndRef = useRef(null);

  const alterSourceSelect = () => {
    setSourceSelect(!sourceSelect);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  useEffect(() => {
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
    setStreamingMessage("");
    setStreamingMetadata(null);

    const currentInput = input;
    setInput("");

    try {
      const response = await fetch(`${VITE_API_BASE_URL}/ask-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: currentInput,
          userId: userId,
        }),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let accumulatedText = "";
      let metadata = {
        cached: false,
        confidence: null,
        sources: [],
        deadline: null,
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log("✅ Stream complete");
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "intent") {
                console.log("🎯 Intent:", data.data);
              } else if (data.type === "text") {
                accumulatedText += data.data;
                setStreamingMessage(accumulatedText);
              } else if (data.type === "metadata") {
                metadata = data.data;
                setStreamingMetadata(metadata);
                console.log("📊 Metadata received:", metadata);
              } else if (data.type === "done") {
                console.log("✅ Generation complete");

                // Add the complete message with metadata
                const botMessage = {
                  role: "bot",
                  text: accumulatedText,
                  ...metadata,
                };

                setMessages((prev) => [...prev, botMessage]);
                setStreamingMessage("");
                setStreamingMetadata(null);
              } else if (data.type === "error") {
                throw new Error(data.data);
              }
            } catch (e) {
              console.warn("Failed to parse SSE data:", e);
            }
          }
        }
      }

      setLoading(false);
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage = {
        role: "bot",
        text: "Sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStreamingMessage("");
      setStreamingMetadata(null);
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
    return "#DC2626";
  };

  const getConfidenceBorderColor = (level) => {
    if (level === "High") return "#e2fee9ff";
    if (level === "Medium") return "#f6fee2ff";
    return "#FEE2E2";
  };

  const getConfidenceIcon = (level) => {
    if (level === "High")
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
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
          width="12"
          height="12"
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
        width="12"
        height="12"
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />
      </svg>
    );
  };

  // Render function for a single message
  const renderMessage = (m, i, isStreaming = false) => (
    <div
      key={i}
      className={`default response ${
        m.role === "user" ? "response-you" : "response-ai"
      }`}
    >
      <div
        className={`default response-msg ${
          m.role === "user" ? "response-msg-you" : "response-msg-ai"
        }`}
      >
        <b className={`default ${m.role === "user" ? "role-you" : "role-ai"}`}>
          {m.role === "user" ? (
            "You"
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              fill="currentColor"
              className="bi bi-stars"
              viewBox="0 0 16 16"
            >
              <path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z" />
            </svg>
          )}
        </b>
        <div className="default lvl-1">
          <div
            className={`default ${
              m.role === "user" ? "message-you" : "message-ai"
            }`}
          >
            <div
              className={`default ${
                m.role === "user" ? "message-you-header" : "message-ai-header"
              }`}
            >
              <div
                className={`default ${
                  m.role === "user"
                    ? "message-you-header-left"
                    : "message-ai-header-left"
                }`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  fill="currentColor"
                  className="bi bi-calendar4"
                  viewBox="0 0 16 16"
                >
                  <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M2 2a1 1 0 0 0-1 1v1h14V3a1 1 0 0 0-1-1zm13 3H1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z" />
                </svg>
                Based on documents uploaded on Dec 21, 2025
              </div>
              <div
                className={`default ${
                  m.role === "user"
                    ? "message-you-header-right"
                    : "message-ai-header-right"
                }`}
              >
                {m.role === "bot" && m.deadline && !isStreaming && (
                  <CalendarButton
                    deadline={m.deadline}
                    userId={userId}
                    onSuccess={(event) => {
                      console.log("Event created:", event);
                    }}
                  />
                )}
              </div>
            </div>
            {m.text}
            {isStreaming && <span className="streaming-cursor">▊</span>}

            {!isStreaming && (
              <div
                className={`default ${
                  m.role === "user" ? "message-you-footer" : "message-ai-footer"
                }`}
              >
                <div className="default message-ai-footer-left">
                  {m.role === "bot" && m.confidence && (
                    <div
                      className="default confidence-badge-main"
                      style={{
                        border: `1px solid ${getConfidenceBorderColor(
                          m.confidence.level
                        )}`,
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

                  {m.role === "bot" && m.hasVisualContent && (
                    <div
                      className="default confidence-badge-main"
                      style={{
                        border: "1px solid #E0E7FF",
                        backgroundColor: "#EEF2FF",
                      }}
                    >
                      <span className="default" style={{ color: "#6366F1" }}>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
                          <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z" />
                        </svg>
                      </span>
                      <span
                        className="default"
                        style={{ fontWeight: 600, color: "#6366F1" }}
                      >
                        Visual Content
                      </span>
                    </div>
                  )}

                  {m.cached && (
                    <div className="default cache-indicator">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="currentColor"
                        className="bi bi-inbox-fill"
                        viewBox="0 0 16 16"
                      >
                        <path d="M4.98 4a.5.5 0 0 0-.39.188L1.54 8H6a.5.5 0 0 1 .5.5 1.5 1.5 0 1 0 3 0A.5.5 0 0 1 10 8h4.46l-3.05-3.812A.5.5 0 0 0 11.02 4zm-1.17-.437A1.5 1.5 0 0 1 4.98 3h6.04a1.5 1.5 0 0 1 1.17.563l3.7 4.625a.5.5 0 0 1 .106.374l-.39 3.124A1.5 1.5 0 0 1 14.117 13H1.883a1.5 1.5 0 0 1-1.489-1.314l-.39-3.124a.5.5 0 0 1 .106-.374z" />
                      </svg>
                      Cached response (similarity:{" "}
                      {(m.similarity * 100).toFixed(1)}%)
                    </div>
                  )}
                </div>
                <div className="default message-ai-footer-right">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    fill="currentColor"
                    className="bi bi-hand-thumbs-up"
                    viewBox="0 0 16 16"
                  >
                    <path d="M8.864.046C7.908-.193 7.02.53 6.956 1.466c-.072 1.051-.23 2.016-.428 2.59-.125.36-.479 1.013-1.04 1.639-.557.623-1.282 1.178-2.131 1.41C2.685 7.288 2 7.87 2 8.72v4.001c0 .845.682 1.464 1.448 1.545 1.07.114 1.564.415 2.068.723l.048.03c.272.165.578.348.97.484.397.136.861.217 1.466.217h3.5c.937 0 1.599-.477 1.934-1.064a1.86 1.86 0 0 0 .254-.912c0-.152-.023-.312-.077-.464.201-.263.38-.578.488-.901.11-.33.172-.762.004-1.149.069-.13.12-.269.159-.403.077-.27.113-.568.113-.857 0-.288-.036-.585-.113-.856a2 2 0 0 0-.138-.362 1.9 1.9 0 0 0 .234-1.734c-.206-.592-.682-1.1-1.2-1.272-.847-.282-1.803-.276-2.516-.211a10 10 0 0 0-.443.05 9.4 9.4 0 0 0-.062-4.509A1.38 1.38 0 0 0 9.125.111zM11.5 14.721H8c-.51 0-.863-.069-1.14-.164-.281-.097-.506-.228-.776-.393l-.04-.024c-.555-.339-1.198-.731-2.49-.868-.333-.036-.554-.29-.554-.55V8.72c0-.254.226-.543.62-.65 1.095-.3 1.977-.996 2.614-1.708.635-.71 1.064-1.475 1.238-1.978.243-.7.407-1.768.482-2.85.025-.362.36-.594.667-.518l.262.066c.16.04.258.143.288.255a8.34 8.34 0 0 1-.145 4.725.5.5 0 0 0 .595.644l.003-.001.014-.003.058-.014a9 9 0 0 1 1.036-.157c.663-.06 1.457-.054 2.11.164.175.058.45.3.57.65.107.308.087.67-.266 1.022l-.353.353.353.354c.043.043.105.141.154.315.048.167.075.37.075.581 0 .212-.027.414-.075.582-.05.174-.111.272-.154.315l-.353.353.353.354c.047.047.109.177.005.488a2.2 2.2 0 0 1-.505.805l-.353.353.353.354c.006.005.041.05.041.17a.9.9 0 0 1-.121.416c-.165.288-.503.56-1.066.56z" />
                  </svg>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    fill="currentColor"
                    className="bi bi-hand-thumbs-down"
                    viewBox="0 0 16 16"
                  >
                    <path d="M8.864 15.674c-.956.24-1.843-.484-1.908-1.42-.072-1.05-.23-2.015-.428-2.59-.125-.36-.479-1.012-1.04-1.638-.557-.624-1.282-1.179-2.131-1.41C2.685 8.432 2 7.85 2 7V3c0-.845.682-1.464 1.448-1.546 1.07-.113 1.564-.415 2.068-.723l.048-.029c.272-.166.578-.349.97-.484C6.931.08 7.395 0 8 0h3.5c.937 0 1.599.478 1.934 1.064.164.287.254.607.254.913 0 .152-.023.312-.077.464.201.262.38.577.488.9.11.33.172.762.004 1.15.069.13.12.268.159.403.077.27.113.567.113.856s-.036.586-.113.856c-.035.12-.08.244-.138.363.394.571.418 1.2.234 1.733-.206.592-.682 1.1-1.2 1.272-.847.283-1.803.276-2.516.211a10 10 0 0 1-.443-.05 9.36 9.36 0 0 1-.062 4.51c-.138.508-.55.848-1.012.964zM11.5 1H8c-.51 0-.863.068-1.14.163-.281.097-.506.229-.776.393l-.04.025c-.555.338-1.198.73-2.49.868-.333.035-.554.29-.554.55V7c0 .255.226.543.62.65 1.095.3 1.977.997 2.614 1.709.635.71 1.064 1.475 1.238 1.977.243.7.407 1.768.482 2.85.025.362.36.595.667.518l.262-.065c.16-.04.258-.144.288-.255a8.34 8.34 0 0 0-.145-4.726.5.5 0 0 1 .595-.643h.003l.014.004.058.013a9 9 0 0 0 1.036.157c.663.06 1.457.054 2.11-.163.175-.059.45-.301.57-.651.107-.308.087-.67-.266-1.021L12.793 7l.353-.354c.043-.042.105-.14.154-.315.048-.167.075-.37.075-.581s-.027-.414-.075-.581c-.05-.174-.111-.273-.154-.315l-.353-.354.353-.354c.047-.047.109-.176.005-.488a2.2 2.2 0 0 0-.505-.804l-.353-.354.353-.354c.006-.005.041-.05.041-.17a.9.9 0 0 0-.121-.415C12.4 1.272 12.063 1 11.5 1" />
                  </svg>
                </div>
              </div>
            )}
          </div>
          {!isStreaming &&
            m.role === "bot" &&
            m.sources &&
            m.sources.length > 0 && (
              <div className="default sources-main">
                <div
                  className="default sources-main-svg-div"
                  onClick={alterSourceSelect}
                >
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
                  {!sourceSelect ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      fill="currentColor"
                      className="bi bi-chevron-down"
                      viewBox="0 0 16 16"
                    >
                      <path
                        fillRule="evenodd"
                        d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      fill="currentColor"
                      className="bi bi-chevron-up"
                      viewBox="0 0 16 16"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708z"
                      />
                    </svg>
                  )}
                </div>

                {m.sources.map((source, idx) => (
                  <div
                    className={`default sources-container-main ${
                      sourceSelect ? "open" : ""
                    }`}
                    key={idx}
                  >
                    <div className="default sources-container-main-top">
                      <div className="default sources-container-main-top-left">
                        {source.type === "visual" ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="#8B5CF6"
                            viewBox="0 0 16 16"
                          >
                            <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
                            <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z" />
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="#0EA5E9"
                            viewBox="0 0 16 16"
                          >
                            <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z" />
                          </svg>
                        )}
                        {source.documentName}.pdf
                        {source.pageNumber && (
                          <span>Page {source.pageNumber}</span>
                        )}
                        <span>{source.similarity}% Match</span>
                        {source.type === "visual" && (
                          <span
                            style={{
                              backgroundColor: "#F3E8FF",
                              color: "#7C3AED",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                            }}
                          >
                            Visual
                          </span>
                        )}
                      </div>
                      <div className="default sources-container-main-top-right">
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
                            PDF
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="default sources-container-main-bottom">
                      "{source.excerpt}"
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        className={`default response-main-div ${
          messages.length ? "show-msg" : "messages"
        }`}
      >
        {/* Render all completed messages */}
        {messages.map((m, i) => renderMessage(m, i, false))}

        {/* Render streaming message if it exists */}
        {streamingMessage &&
          renderMessage(
            {
              role: "bot",
              text: streamingMessage,
              ...streamingMetadata,
            },
            messages.length,
            true
          )}

        <div ref={messagesEndRef} />

        {loading && !streamingMessage && (
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
