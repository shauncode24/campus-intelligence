import { useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "../utils/api";
import toast from "react-hot-toast";

const { VITE_API_BASE_URL, VITE_PYTHON_RAG_URL } = import.meta.env;

export function useChat(chatId, userId) {
  const [messages, setMessages] = useState([]);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [streamingMetadata, setStreamingMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef(null);
  // What has streamed in so far, readable from "stop" (state is stale inside callbacks)
  const partialRef = useRef({ text: "", metadata: null });

  // Load messages when chatId changes
  useEffect(() => {
    // IMMEDIATELY clear state on chatId change
    setMessages([]);
    setStreamingMessage("");
    setStreamingMetadata(null);
    setLoading(false);

    if (!chatId) return;

    const controller = new AbortController();

    async function loadMessages() {
      try {
        const response = await apiFetch(
          `${VITE_PYTHON_RAG_URL}/chats/${chatId}/messages?limit=200`,
          { signal: controller.signal }
        );
        const data = await response.json();

        if (data.success && data.messages.length > 0) {
          const formatted = data.messages.map((msg) => ({
            role: msg.role,
            text: msg.content,
            timestamp: msg.createdAt, // ✅ Add timestamp from Firebase
            messageId: msg.id, // what feedback is attached to (older messages carry no copy in metadata)
            ...(msg.metadata || {}),
          }));
          setMessages(formatted);
        } else {
          setMessages([]);
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

  // options.regenerate: answer this question afresh (never from a stored answer)
  // options.retry: the last attempt failed; ask again without repeating the question in the chat
  const sendMessage = useCallback(
    async (input, options = {}) => {
      if (!input.trim() || !chatId || !userId) return;

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // ✅ Create timestamp for user message
      const userTimestamp = new Date().toISOString();

      const userMessage = options.regenerate
        ? { role: "user", regenerated: true, text: input, timestamp: userTimestamp }
        : { role: "user", text: input, timestamp: userTimestamp };

      if (options.retry) {
        // drop the failure message the retry replaces
        setMessages((prev) => (prev.length && prev[prev.length - 1].isError ? prev.slice(0, -1) : prev));
      } else {
        setMessages((prev) => [...prev, userMessage]);
      }
      partialRef.current = { text: "", metadata: null };
      setLoading(true);
      setStreamingMessage("");
      setStreamingMetadata(null);

      try {
        const response = await apiFetch(`${VITE_API_BASE_URL}/document/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The server saves the question and answer into this chat and reads the earlier
          // turns itself (follow-ups); the browser writes nothing.
          body: JSON.stringify({
            question: input,
            chatId,
            ...(options.regenerate ? { regenerate: true } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // 429 = rate limit: the server's message is written for users
          let message = "Network response was not ok";
          if (response.status === 429) {
            const body = await response.json().catch(() => ({}));
            message =
              body.error ||
              "You're sending questions too quickly. Please wait a moment.";
          }
          const failure = new Error(message);
          failure.userFacing = response.status === 429;
          throw failure;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let buffered = ""; // a line can arrive split across two reads
        // Set when the server sends an error event. It must be handled after
        // the loop: throwing inside the per-line try/catch below would only be
        // logged and the user would see nothing.
        let streamError = null;
        let metadata = {
          cached: false,
          sources: [],
          deadline: null,
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop(); // the last piece may be incomplete: keep it for the next read

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "text") {
                  accumulatedText += data.data;
                  partialRef.current.text = accumulatedText;
                  setStreamingMessage(accumulatedText);
                } else if (data.type === "metadata") {
                  metadata = data.data;
                  partialRef.current.metadata = metadata;
                  setStreamingMetadata(metadata);
                } else if (data.type === "done") {
                  // metadata (from the server) already carries historyId, so Save
                  // works at once and the same message loads after a reload
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "bot",
                      text: accumulatedText,
                      timestamp: new Date().toISOString(),
                      ...metadata,
                    },
                  ]);
                  if (metadata.saved === false) {
                    toast.error(
                      "This answer could not be saved to your history."
                    );
                  }
                  setStreamingMessage("");
                  setStreamingMetadata(null);
                } else if (data.type === "error") {
                  streamError = data;
                }
              } catch (e) {
                console.warn("Failed to parse SSE data:", e);
              }
            }
          }
        }

        if (streamError) {
          const failure = new Error(streamError.data);
          failure.userFacing = streamError.userFacing === true;
          throw failure;
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Error sending message:", error);

          const errorTimestamp = new Date().toISOString();
          setMessages((prev) => [
            ...prev,
            {
              role: "bot",
              // Only show server text that was written for users (limits);
              // everything else stays generic.
              text: error.userFacing
                ? error.message
                : "Sorry, I encountered an error. Please try again.",
              isError: true,
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
    [chatId, userId]
  );

  // Stop waiting for the answer. The server has already saved the exchange by the time the answer
  // starts to appear, so what is shown is kept, marked as stopped; reopening the chat shows it all.
  const stopGenerating = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    const { text, metadata } = partialRef.current;
    controller.abort();
    if (text) {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text, timestamp: new Date().toISOString(), ...(metadata || {}), stopped: true },
      ]);
    }
    setStreamingMessage("");
    setStreamingMetadata(null);
    setLoading(false);
  }, []);

  const lastQuestion = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user" && !m.regenerated && m.text) return m.text;
    }
    return null;
  }, [messages]);

  /** "Try again": a fresh answer to the last question. */
  const regenerate = useCallback(() => {
    const question = lastQuestion();
    if (question && !loading) sendMessage(question, { regenerate: true });
  }, [lastQuestion, loading, sendMessage]);

  /** After an error message: ask the same question again. */
  const retry = useCallback(() => {
    const question = lastQuestion();
    if (question && !loading) sendMessage(question, { retry: true });
  }, [lastQuestion, loading, sendMessage]);

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
    stopGenerating,
    regenerate,
    retry,
    hasMessages: messages.length > 0,
  };
}
