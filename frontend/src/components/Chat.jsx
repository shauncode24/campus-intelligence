import { useState, useEffect } from "react";
import ChatInput from "./ChatInput";

const { VITE_API_BASE_URL } = import.meta.env;

export default function Chat({ onMessagesChange, onStreamingUpdate }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [streamingMetadata, setStreamingMetadata] = useState(null);

  useEffect(() => {
    console.log("Messages: ", messages);
  }, [messages]);

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
  }, [messages.length, onMessagesChange]);

  // Update parent component whenever chat state changes
  useEffect(() => {
    if (onStreamingUpdate) {
      onStreamingUpdate({
        messages,
        streamingMessage,
        streamingMetadata,
        loading,
        userId,
      });
    }
  }, [messages, streamingMessage, streamingMetadata, loading, userId]);

  const sendMessage = async (input) => {
    if (!input.trim()) return;

    const userMessage = { role: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setStreamingMessage("");
    setStreamingMetadata(null);

    try {
      const response = await fetch(`${VITE_API_BASE_URL}/document/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: input,
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

  return <ChatInput onSendMessage={sendMessage} loading={loading} />;
}
