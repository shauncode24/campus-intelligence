import { useRef, useEffect } from "react";
import Message from "./Message";
import "../styles/MessageList.css";
import MessageSkeleton from "../components/Loading/MessageSkeleton";

export default function MessageList({
  messages,
  streamingMessage,
  streamingMetadata,
  loading,
  userId,
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  return (
    <div className="message-list-container">
      {messages.map((m, i) => (
        <Message key={i} message={m} userId={userId} isStreaming={false} />
      ))}

      {streamingMessage && (
        <Message
          message={{
            role: "bot",
            text: streamingMessage,
            ...streamingMetadata,
          }}
          userId={userId}
          isStreaming={true}
        />
      )}

      <div ref={messagesEndRef} />

      {loading && !streamingMessage && messages.length === 0 && (
        <>
          <MessageSkeleton />
          <MessageSkeleton />
        </>
      )}

      {loading && !streamingMessage && messages.length > 0 && (
        <div className="thinking-indicator">
          <div className="thinking-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
    </div>
  );
}
