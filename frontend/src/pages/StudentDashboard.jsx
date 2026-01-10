import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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

const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function StudentDashboard() {
  usePageTitle("Ask Questions");
  const location = useLocation();
  const navigate = useNavigate();

  const { state, actions } = useApp();
  const userId = state.user.id;
  const sidebarOpen = state.theme.sidebarOpen;
  const pendingQuestion = state.navigation.pendingQuestion;

  const [currentChatId, setCurrentChatId] = useState(null);
  const [loadingChat, setLoadingChat] = useState(true);

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
      if (!userId) {
        console.log("⏳ Waiting for userId...");
        return;
      }

      console.log("🚀 Initializing chat for user:", userId);
      const searchParams = new URLSearchParams(location.search);
      const chatIdFromUrl = searchParams.get("chat");
      console.log("🔍 Chat ID from URL:", chatIdFromUrl);

      if (chatIdFromUrl) {
        console.log("📖 Loading existing chat:", chatIdFromUrl);
        setCurrentChatId(chatIdFromUrl);
        setLoadingChat(false);
      } else {
        console.log("➕ No chat ID in URL, creating new chat...");
        await createNewChat(controller.signal);
      }
    };

    initializeChat();

    return () => controller.abort();
  }, [userId, location.search]);

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
    console.log("🆕 Creating new chat...");
    try {
      const url = `${VITE_PYTHON_RAG_URL}/chats/create`;
      console.log("📡 POST request to:", url);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId,
          title: "New Chat",
        }),
        signal,
      });

      console.log("📊 Response status:", response.status);
      const data = await response.json();
      console.log("📝 Response data:", data);

      if (data.success) {
        console.log("✅ Chat created with ID:", data.chatId);
        setCurrentChatId(data.chatId);
        navigate(`/student?chat=${data.chatId}`, { replace: true });
      } else {
        console.error("❌ Failed to create chat:", data);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        handleError(error, { customMessage: "Failed to create new chat" });
      }
    } finally {
      setLoadingChat(false);
    }
  };

  const handleChatSelect = async (chatId) => {
    console.log("🔄 Switching to chat:", chatId);
    setLoadingChat(true);
    setCurrentChatId(chatId);
    setLoadingChat(false);
    navigate(`/student?chat=${chatId}`);
  };

  if (loadingChat) {
    return (
      <>
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={actions.toggleSidebar}
          currentChatId={currentChatId}
          onChatSelect={handleChatSelect}
        />
        <div className={`main-content ${sidebarOpen ? "sidebar-open" : ""}`}>
          <Header sidebarOpen={sidebarOpen} />
          <div className="dashboard-content">
            <div className="loading-chat">
              <div className="spinner-large"></div>
              <p>Loading chat...</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={actions.toggleSidebar}
        currentChatId={currentChatId}
        onChatSelect={handleChatSelect}
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
