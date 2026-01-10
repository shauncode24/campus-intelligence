import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Chat from "../components/Chat";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import MessageList from "../components/MessageList";
import { usePageTitle } from "../components/usePageTitle";
import "./StudentDashboard.css";
import { useApp } from "../contexts/AppContext";

const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function StudentDashboard() {
  usePageTitle("Ask Questions");
  const location = useLocation();
  const navigate = useNavigate();
  const chatRef = useRef(null);

  const { state, actions } = useApp();
  const userId = state.user.id;
  const sidebarOpen = state.theme.sidebarOpen;

  const [hasMessages, setHasMessages] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [loadingChat, setLoadingChat] = useState(true);
  const [chatState, setChatState] = useState({
    messages: [],
    streamingMessage: "",
    streamingMetadata: null,
    loading: false,
    userId: "",
  });

  // Check for chat ID in URL or create new chat
  useEffect(() => {
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
        // Load existing chat
        console.log("📖 Loading existing chat:", chatIdFromUrl);
        setCurrentChatId(chatIdFromUrl);

        // Clear any existing messages first
        setChatState((prev) => ({
          ...prev,
          messages: [],
        }));

        await loadChatMessages(chatIdFromUrl);
        setLoadingChat(false);
      } else {
        // Create new chat
        console.log("➕ No chat ID in URL, creating new chat...");
        await createNewChat();
      }
    };

    initializeChat();
  }, [userId, location.search]);

  // Check if there's a reask question from history
  useEffect(() => {
    const reaskQuestion = localStorage.getItem("reask_question");
    if (reaskQuestion && chatRef.current) {
      // Wait for chat to be ready, then send the message
      setTimeout(() => {
        chatRef.current.sendMessage(reaskQuestion);
        localStorage.removeItem("reask_question");
      }, 500);
    }
  }, [currentChatId]);

  const createNewChat = async () => {
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
      });

      console.log("📊 Response status:", response.status);
      const data = await response.json();
      console.log("📝 Response data:", data);

      if (data.success) {
        console.log("✅ Chat created with ID:", data.chatId);

        // Clear messages for new chat
        setChatState((prev) => ({
          ...prev,
          messages: [],
        }));

        setCurrentChatId(data.chatId);
        setHasMessages(false); // Reset to show welcome screen
        navigate(`/student?chat=${data.chatId}`, { replace: true });
      } else {
        console.error("❌ Failed to create chat:", data);
      }
    } catch (error) {
      console.error("❌ Error creating new chat:", error);
    } finally {
      setLoadingChat(false);
    }
  };

  const loadChatMessages = async (chatId) => {
    const controller = new AbortController();
    console.log("📥 Loading messages for chat:", chatId);
    try {
      const url = `${VITE_PYTHON_RAG_URL}/chats/${chatId}/messages?limit=100`;
      console.log("📡 GET request to:", url);

      const response = await fetch(url, { signal: controller.signal });
      console.log("📊 Response status:", response.status);

      const data = await response.json();
      console.log("📨 Messages data:", data);

      if (data.success && data.messages.length > 0) {
        console.log(`✅ Loaded ${data.messages.length} messages`);

        // Convert messages to the format expected by MessageList
        const formattedMessages = data.messages.map((msg) => ({
          role: msg.role,
          text: msg.content,
          ...(msg.metadata || {}),
        }));

        console.log("📝 Formatted messages:", formattedMessages);

        setChatState((prev) => ({
          ...prev,
          messages: formattedMessages,
        }));
        setHasMessages(true);
      } else {
        console.log("📭 No messages in this chat yet");
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("❌ Error loading chat messages:", error);
    }
  };

  const handleStreamingUpdate = useCallback((state) => {
    setChatState(state);
  }, []);

  const handleChatSelect = async (chatId) => {
    console.log("🔄 Switching to chat:", chatId);
    setLoadingChat(true);
    setCurrentChatId(chatId);

    // Clear current messages before loading new ones
    setChatState((prev) => ({
      ...prev,
      messages: [],
      streamingMessage: "",
      streamingMetadata: null,
    }));

    // Load messages for the selected chat
    await loadChatMessages(chatId);

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
          {/* <Footer /> */}
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
              messages={chatState.messages}
              streamingMessage={chatState.streamingMessage}
              streamingMetadata={chatState.streamingMetadata}
              loading={chatState.loading}
              userId={chatState.userId}
            />
          )}
        </div>

        {/* <Footer /> */}

        {currentChatId && (
          <Chat
            key={currentChatId} // Force re-render when chat changes
            ref={chatRef}
            chatId={currentChatId}
            initialMessages={chatState.messages}
            onMessagesChange={setHasMessages}
            onStreamingUpdate={handleStreamingUpdate}
            sidebarOpen={sidebarOpen}
          />
        )}
      </div>
    </>
  );
}
