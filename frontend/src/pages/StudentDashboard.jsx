import { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ChatInput from "../components/ChatInput";
import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import MessageList from "../components/MessageList";
import { usePageTitle } from "../components/usePageTitle";
import { useChat } from "../hooks/useChat";
import { useApp } from "../contexts/AppContext";
import { handleError } from "../utils/errors";
import "./StudentDashboard.css";
import MessageSkeleton from "../components/Loading/MessageSkeleton";
import Spinner from "../components/Loading/Spinner";

const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function StudentDashboard() {
  usePageTitle("Ask Questions");
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { state, actions } = useApp();
  const userId = state.user.id;
  const sidebarOpen = state.theme.sidebarOpen;
  const pendingQuestion = state.navigation.pendingQuestion;

  // ✅ URL is source of truth
  const currentChatId = searchParams.get("chat");

  const {
    messages,
    streamingMessage,
    streamingMetadata,
    loading,
    sendMessage,
    hasMessages,
  } = useChat(currentChatId, userId);

  // Check for chat ID in URL or create new chat
  useEffect(() => {
    const controller = new AbortController();

    const initializeChat = async () => {
      if (!userId) return;

      const chatIdFromUrl = searchParams.get("chat");

      if (!chatIdFromUrl) {
        await createNewChat(controller.signal);
      }
    };

    initializeChat();

    return () => controller.abort();
  }, [userId, searchParams]);

  // Remove setLoadingChat(false) calls

  // Check if there's a reask question from history
  useEffect(() => {
    if (pendingQuestion && currentChatId && sendMessage) {
      setTimeout(() => {
        sendMessage(pendingQuestion);
        actions.setPendingQuestion(null); // Clear it
      }, 500);
    }
  }, [pendingQuestion, currentChatId, sendMessage, actions]);

  const createNewChat = async (signal) => {
    try {
      const response = await fetch(`${VITE_PYTHON_RAG_URL}/chats/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId,
          title: "New Chat",
        }),
        signal,
      });

      const data = await response.json();

      if (data.success) {
        navigate(`/student?chat=${data.chatId}`, { replace: true });
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        handleError(error, { customMessage: "Failed to create new chat" });
      }
    }
  };

  return (
    <>
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={actions.toggleSidebar}
        currentChatId={currentChatId}
      />

      <div className={`main-content ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Header sidebarOpen={sidebarOpen} />

        <div
          className={`default dashboard-content ${
            !hasMessages ? "visible" : "hidden"
          }`}
        >
          <WelcomeScreen isVisible={!hasMessages} sidebarOpen={sidebarOpen} />

          {hasMessages && (
            <MessageList
              messages={messages}
              streamingMessage={streamingMessage}
              streamingMetadata={streamingMetadata}
              loading={loading}
              userId={userId}
            />
          )}
        </div>

        {currentChatId && (
          <ChatInput
            onSendMessage={sendMessage}
            loading={loading}
            sidebarOpen={sidebarOpen}
          />
        )}
      </div>
    </>
  );
}
