import { useState, useCallback, useRef, useEffect } from "react";

const { VITE_API_BASE_URL, VITE_PYTHON_RAG_URL } = import.meta.env;

export function useChat(chatId, userId) {
  const [messages, setMessages] = useState([]);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [streamingMetadata, setStreamingMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isFirstMessage, setIsFirstMessage] = useState(true);
  const abortControllerRef = useRef(null);

  // Load messages when chatId changes
  useEffect(() => {
    // IMMEDIATELY clear state on chatId change
    setMessages([]);
    setStreamingMessage("");
    setStreamingMetadata(null);
    setLoading(false);
    setIsFirstMessage(true);

    if (!chatId) return;

    const controller = new AbortController();

    async function loadMessages() {
      try {
        const response = await fetch(
          `${VITE_PYTHON_RAG_URL}/chats/${chatId}/messages?limit=100`,
          { signal: controller.signal }
        );
        const data = await response.json();

        if (data.success && data.messages.length > 0) {
          const formatted = data.messages.map((msg) => ({
            role: msg.role,
            text: msg.content,
            timestamp: msg.createdAt, // ✅ Add timestamp from Firebase
            ...(msg.metadata || {}),
          }));
          setMessages(formatted);
          setIsFirstMessage(false);
        } else {
          setMessages([]);
          setIsFirstMessage(true);
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Error loading messages:", error);
        }
      }
    }

    loadMessages();

    return () => {
      controller.abort();
      setMessages([]);
      setStreamingMessage("");
      setStreamingMetadata(null);
    };
  }, [chatId]);

  const sendMessage = useCallback(
    async (input) => {
      if (!input.trim() || !chatId || !userId) return;

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // ✅ Create timestamp for user message
      const userTimestamp = new Date().toISOString();

      const userMessage = {
        role: "user",
        text: input,
        timestamp: userTimestamp,
      };

      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);
      setStreamingMessage("");
      setStreamingMetadata(null);

      // Save user message with timestamp
      try {
        await fetch(`${VITE_PYTHON_RAG_URL}/chats/messages/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            role: "user",
            content: input,
            metadata: { timestamp: userTimestamp }, // ✅ Store timestamp
          }),
          signal: controller.signal,
        });

        // Auto-generate title for first message
        if (isFirstMessage) {
          await fetch(`${VITE_PYTHON_RAG_URL}/chats/${chatId}/auto-title`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstMessage: input }),
            signal: controller.signal,
          });
          setIsFirstMessage(false);
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Error saving user message:", error);
        }
      }

      try {
        const response = await fetch(`${VITE_API_BASE_URL}/document/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: input, userId }),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error("Network response was not ok");

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
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "text") {
                  accumulatedText += data.data;
                  setStreamingMessage(accumulatedText);
                } else if (data.type === "metadata") {
                  metadata = data.data;
                  setStreamingMetadata(metadata);
                } else if (data.type === "done") {
                  // ✅ Create timestamp for bot message
                  const botTimestamp = new Date().toISOString();

                  const botMessage = {
                    role: "bot",
                    text: accumulatedText,
                    timestamp: botTimestamp,
                    ...metadata,
                  };
                  setMessages((prev) => [...prev, botMessage]);
                  setStreamingMessage("");
                  setStreamingMetadata(null);

                  // Save bot message with timestamp
                  await fetch(`${VITE_PYTHON_RAG_URL}/chats/messages/add`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chatId,
                      role: "bot",
                      content: accumulatedText,
                      metadata: {
                        ...metadata,
                        timestamp: botTimestamp, // ✅ Store timestamp
                      },
                    }),
                  });
                } else if (data.type === "error") {
                  throw new Error(data.data);
                }
              } catch (e) {
                console.warn("Failed to parse SSE data:", e);
              }
            }
          }
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Error sending message:", error);

          const errorTimestamp = new Date().toISOString();
          setMessages((prev) => [
            ...prev,
            {
              role: "bot",
              text: "Sorry, I encountered an error. Please try again.",
              timestamp: errorTimestamp,
            },
          ]);
          setStreamingMessage("");
          setStreamingMetadata(null);
        }
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }
    },
    [chatId, userId, isFirstMessage]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    messages,
    streamingMessage,
    streamingMetadata,
    loading,
    sendMessage,
    hasMessages: messages.length > 0,
  };
}
