import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import ChatInput from "./ChatInput";

const { VITE_API_BASE_URL, VITE_PYTHON_RAG_URL } = import.meta.env;

const Chat = forwardRef(
  (
    {
      chatId,
      initialMessages = [],
      onMessagesChange,
      onStreamingUpdate,
      sidebarOpen,
    },
    ref
  ) => {
    const [messages, setMessages] = useState(initialMessages);
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState("");
    const [streamingMessage, setStreamingMessage] = useState("");
    const [streamingMetadata, setStreamingMetadata] = useState(null);
    const [isFirstMessage, setIsFirstMessage] = useState(true);

    // Sync with initialMessages when they change (when loading a different chat)
    useEffect(() => {
      console.log(
        "🔄 Syncing messages with initialMessages:",
        initialMessages.length
      );
      setMessages(initialMessages);
    }, [initialMessages]);

    useEffect(() => {
      console.log("Messages state updated:", messages.length);
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
    }, [
      messages,
      streamingMessage,
      streamingMetadata,
      loading,
      userId,
      onStreamingUpdate,
    ]);

    // Check if this is the first message in the chat
    useEffect(() => {
      if (chatId) {
        checkChatMessages();
      }
    }, [chatId]);

    const checkChatMessages = async () => {
      try {
        const response = await fetch(
          `${VITE_PYTHON_RAG_URL}/chats/${chatId}/messages?limit=1`
        );
        const data = await response.json();
        setIsFirstMessage(data.messages.length === 0);
      } catch (error) {
        console.error("Error checking chat messages:", error);
      }
    };

    const sendMessage = async (input) => {
      if (!input.trim() || !chatId) return;

      const userMessage = {
        role: "user",
        text: input,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);
      setStreamingMessage("");
      setStreamingMetadata(null);

      // Save user message to chat
      try {
        await fetch(`${VITE_PYTHON_RAG_URL}/chats/messages/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: chatId,
            role: "user",
            content: input,
            metadata: {},
          }),
        });

        // Auto-generate title for first message
        if (isFirstMessage) {
          await fetch(`${VITE_PYTHON_RAG_URL}/chats/${chatId}/auto-title`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              firstMessage: input,
            }),
          });
          setIsFirstMessage(false);
        }
      } catch (error) {
        console.error("Error saving user message:", error);
      }

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

                  // Save bot message to chat
                  try {
                    await fetch(`${VITE_PYTHON_RAG_URL}/chats/messages/add`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        chatId: chatId,
                        role: "bot",
                        content: accumulatedText,
                        metadata: metadata,
                      }),
                    });

                    // Add this:
                    const historyResponse = await fetch(
                      `${VITE_PYTHON_RAG_URL}/history/${userId}?limit=1`
                    );
                    const historyData = await historyResponse.json();
                    const latestHistory = historyData.history[0];

                    // Update the bot message in state with historyId
                    setMessages((prev) =>
                      prev.map((msg, idx) =>
                        idx === prev.length - 1
                          ? { ...msg, historyId: latestHistory.id }
                          : msg
                      )
                    );
                  } catch (error) {
                    console.error("Error saving bot message:", error);
                  }
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

    // Expose sendMessage method to parent via ref
    useImperativeHandle(ref, () => ({
      sendMessage,
    }));

    return (
      <ChatInput
        onSendMessage={sendMessage}
        loading={loading}
        sidebarOpen={sidebarOpen}
      />
    );
  }
);

Chat.displayName = "Chat";

export default Chat;
