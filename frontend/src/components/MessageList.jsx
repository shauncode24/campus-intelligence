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
  onRegenerate,
  onRetry,
}) {
  const messagesEndRef = useRef(null);
  // "Try again" is offered on the most recent answer only
  let lastAnswerIndex = -1;
  messages.forEach((m, i) => {
    if (m.role === "bot") lastAnswerIndex = i;
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  return (
    <div className="message-list-container">
      {messages.map((m, i) => (
        <Message
          // a stable key (not the position) so a message keeps its own state (rating, saved)
          // when others are added around it
          key={m.messageId || m.timestamp || i}
          message={m}
          userId={userId}
          isStreaming={false}
          isLast={i === lastAnswerIndex}
          onRegenerate={loading ? undefined : onRegenerate}
          onRetry={loading ? undefined : onRetry}
        />
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
