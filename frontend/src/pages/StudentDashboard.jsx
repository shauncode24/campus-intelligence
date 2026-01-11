import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import MessageList from "../components/MessageList";
import ChatInput from "../components/ChatInput";
import { useChat } from "../hooks/useChat";
import { useApp } from "../contexts/AppContext";
import { usePageTitle } from "../components/usePageTitle";
import { handleError } from "../utils/errors";
import "./StudentDashboard.css";
import Header from "./../components/Header";

const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function StudentDashboard() {
  usePageTitle("Dashboard");
  const location = useLocation();
  const navigate = useNavigate();
  const { state, actions } = useApp();
  const userId = state.user.id;
  const sidebarOpen = state.theme.sidebarOpen;

  const [currentChatId, setCurrentChatId] = useState(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  const isInitialized = useRef(false);
  const lastFetchedUserId = useRef(null);

  const {
    messages,
    streamingMessage,
    streamingMetadata,
    loading,
    sendMessage,
  } = useChat(currentChatId, userId);

  // ✅ FIX 1: Initialize user and fetch chats ONCE
  useEffect(() => {
    if (!userId || userId === lastFetchedUserId.current) return;

    console.log("🔄 Initializing for user:", userId);
    lastFetchedUserId.current = userId;

    const initializeUser = async () => {
      try {
        await actions.fetchChats(userId);
        isInitialized.current = true;
      } catch (error) {
        console.error("Failed to initialize:", error);
      }
    };

    initializeUser();
  }, [userId]); // Only depend on userId

  // ✅ FIX 2: Handle URL navigation AFTER chats are loaded
  useEffect(() => {
    if (!userId || !isInitialized.current) return;

    const params = new URLSearchParams(location.search);
    const chatIdFromUrl = params.get("chat");

    console.log("📍 Navigation check:", {
      chatIdFromUrl,
      currentChatId,
      chatsCount: state.chats.data.length,
    });

    if (chatIdFromUrl) {
      // URL has a chat ID - use it
      if (chatIdFromUrl !== currentChatId) {
        setCurrentChatId(chatIdFromUrl);
      }
    } else {
      // No chat ID in URL
      if (state.chats.data.length > 0) {
        // Use most recent chat
        const mostRecentChat = state.chats.data[0];
        navigate(`/student?chat=${mostRecentChat.id}`, { replace: true });
      } else if (!creatingChat) {
        // No chats exist - create one
        handleNewChat();
      }
    }
  }, [location.search, state.chats.data, userId, isInitialized.current]);

  // ✅ FIX 3: Handle pending questions
  useEffect(() => {
    if (state.navigation.pendingQuestion && currentChatId && !loading) {
      sendMessage(state.navigation.pendingQuestion);
      actions.setPendingQuestion(null);
    }
  }, [state.navigation.pendingQuestion, currentChatId, loading]);

  const handleNewChat = async () => {
    if (creatingChat) {
      console.log("⏸️ Already creating chat, skipping...");
      return;
    }

    console.log("➕ Creating new chat...");
    setCreatingChat(true);

    try {
      const response = await fetch(`${VITE_PYTHON_RAG_URL}/chats/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId,
          title: "New Chat",
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log("✅ Chat created:", data.chatId);

        // ✅ Wait for chats to refresh before navigating
        await actions.fetchChats(userId, true);

        setCurrentChatId(data.chatId);
        navigate(`/student?chat=${data.chatId}`, { replace: true });
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to create new chat" });
    } finally {
      setCreatingChat(false);
    }
  };

  const handleSidebarToggle = () => {
    actions.toggleSidebar();
  };

  const showWelcome = !loading && !streamingMessage && messages.length === 0;

  if (loadingChat) {
    return (
      <div className="main-content">
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={handleSidebarToggle}
          currentChatId={currentChatId}
        />
        <div className="loading-chat">
          <div className="spinner-large"></div>
          <p>Loading chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      <Header sidebarOpen={sidebarOpen} />
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={handleSidebarToggle}
        currentChatId={currentChatId}
      />

      <div className={`main-content ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className={`dashboard-content ${showWelcome ? "" : "hidden"}`}>
          <WelcomeScreen isVisible={showWelcome} sidebarOpen={sidebarOpen} />

          {!showWelcome && (
            <MessageList
              messages={messages}
              streamingMessage={streamingMessage}
              streamingMetadata={streamingMetadata}
              loading={loading}
              userId={userId}
            />
          )}
        </div>

        <ChatInput
          onSendMessage={sendMessage}
          loading={loading}
          sidebarOpen={sidebarOpen}
        />
      </div>
    </div>
  );
}
