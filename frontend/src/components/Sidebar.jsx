import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Sidebar.css";
import { useApp } from "../contexts/AppContext";
import { parseTimestamp } from "../utils/validation";
import { handleError } from "../utils/errors";
import ChatListSkeleton from "../components/Loading/ChatListSkeleton";

const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function Sidebar({
  isOpen,
  onToggle,
  currentChatId,
  onChatSelect,
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [recentChats, setRecentChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState(null);
  const [error, setError] = useState(null);
  const [savedCount, setSavedCount] = useState(0);

  const { state } = useApp();
  const userId = state.user.id;

  useEffect(() => {
    if (userId) {
      fetchUserChats(userId);
      fetchSavedCount(userId);
    }
  }, [userId]);

  // Refetch chats when currentChatId changes (after creating new chat)
  useEffect(() => {
    if (userId && currentChatId) {
      console.log(
        "🔄 Refetching chats due to currentChatId change:",
        currentChatId
      );
      fetchUserChats(userId);
      fetchSavedCount(userId);
    }
  }, [currentChatId]);

  const fetchUserChats = async (uid) => {
    const controller = new AbortController();
    setLoadingChats(true);
    setError(null);

    const url = `${VITE_PYTHON_RAG_URL}/chats/user/${uid}?limit=10`;
    console.log("📡 Fetching chats from:", url);

    try {
      const response = await fetch(url, { signal: controller.signal });
      console.log("📊 Response status:", response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log("✅ Chats data received:", data);

      if (data.success && Array.isArray(data.chats)) {
        console.log(`📋 Setting ${data.chats.length} chats`);
        setRecentChats(data.chats);
      } else {
        console.warn("⚠️ Unexpected data format:", data);
        setRecentChats([]);
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      handleError(error, { customMessage: "Failed to load chats" });
      setRecentChats([]);
    } finally {
      setLoadingChats(false);
    }
  };

  const fetchSavedCount = async (uid) => {
    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/history/${uid}?limit=100&favorites_only=true`
      );
      const data = await response.json();
      setSavedCount(data.history?.length || 0);
    } catch (error) {
      handleError(error, { silent: true });
    }
  };

  const handleNewChat = async () => {
    console.log("➕ Creating new chat for user:", userId);

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
      console.log("📝 Create chat response:", data);

      if (data.success) {
        console.log("✅ Chat created with ID:", data.chatId);

        // Refresh chats list immediately
        await fetchUserChats(userId);

        // Navigate to the new chat
        if (onChatSelect) {
          onChatSelect(data.chatId);
        }
        navigate(`/student?chat=${data.chatId}`);
      } else {
        console.error("❌ Failed to create chat:", data);
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to create new chat" });
    }
  };

  const handleDeleteChat = async (chatId, e) => {
    e.stopPropagation();

    if (!confirm("Are you sure you want to delete this chat?")) {
      return;
    }

    console.log("🗑️ Deleting chat:", chatId);
    setDeletingChatId(chatId);

    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/chats/${chatId}/user/${userId}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (data.success) {
        console.log("✅ Chat deleted successfully");

        // Refresh chats list
        await fetchUserChats(userId);

        // If we deleted the current chat, create a new one
        if (currentChatId === chatId) {
          handleNewChat();
        }
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to delete chat" });
    } finally {
      setDeletingChatId(null);
    }
  };

  const handleChatClick = (chatId) => {
    console.log("💬 Selecting chat:", chatId);
    if (onChatSelect) {
      onChatSelect(chatId);
    }
    navigate(`/student?chat=${chatId}`);
  };

  const formatTimestamp = (timestamp) => {
    const date = parseTimestamp(timestamp);
    if (!date) return "Just now";

    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const menuItems = [
    {
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z" />
          <path d="M5 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0m4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0" />
        </svg>
      ),
      label: "Recent Chats",
      count: recentChats.length,
      active: true,
    },
    {
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1z" />
        </svg>
      ),
      label: "Saved Answers",
      count: savedCount,
      onClick: () => navigate("/saved-answers"),
    },
  ];

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onToggle}></div>}

      <div className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                fill="white"
                viewBox="0 0 16 16"
              >
                <path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0-1 1v2h3v-2a1 1 0 0 0-1-1V6.739l.686-.275a.5.5 0 0 0 .025-.917zM8 8.46 1.758 5.965 8 3.052l6.242 2.913z" />
                <path d="M4.176 9.032a.5.5 0 0 0-.656.327l-.5 1.7a.5.5 0 0 0 .294.605l4.5 1.8a.5.5 0 0 0 .372 0l4.5-1.8a.5.5 0 0 0 .294-.605l-.5-1.7a.5.5 0 0 0-.656-.327L8 10.466zm-.068 1.873.22-.748 3.496 1.311a.5.5 0 0 0 .352 0l3.496-1.311.22.748L8 12.46z" />
              </svg>
            </div>
            <span className="logo-text">
              Campus<span className="logo-ai">&nbsp;Intel</span>
            </span>
          </div>
        </div>

        <button className="new-chat-btn" onClick={handleNewChat}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Chat
        </button>

        <div className="sidebar-section">
          <div className="sidebar-section-label">MENU</div>
          {menuItems.map((item, index) => (
            <div
              key={index}
              className={`sidebar-menu-item ${item.active ? "active" : ""}`}
              onClick={item.onClick}
            >
              <span className="menu-item-icon">{item.icon}</span>
              <span className="menu-item-label">{item.label}</span>
              <span className="menu-item-count">{item.count}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">
            RECENT
            <button
              onClick={() => fetchUserChats(userId)}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#5f6368",
                fontSize: "12px",
              }}
            >
              🔄
            </button>
          </div>

          {error && (
            <div
              className="sidebar-error"
              style={{
                padding: "8px",
                background: "#fce8e6",
                color: "#c5221f",
                borderRadius: "4px",
                fontSize: "12px",
                marginBottom: "8px",
              }}
            >
              {error}
            </div>
          )}

          {loadingChats ? (
            <ChatListSkeleton count={5} />
          ) : recentChats.length === 0 ? (
            <div className="sidebar-empty">
              <p style={{ fontSize: "13px", color: "#5f6368", padding: "8px" }}>
                No chats yet. Click "New Chat" to start!
              </p>
              <p
                style={{ fontSize: "11px", color: "#80868b", padding: "0 8px" }}
              >
                User ID: {userId?.substring(0, 15)}...
              </p>
            </div>
          ) : (
            recentChats.map((chat) => (
              <div
                key={chat.id}
                className={`sidebar-recent-item ${
                  currentChatId === chat.id ? "active" : ""
                }`}
                onClick={() => handleChatClick(chat.id)}
              >
                <div className="recent-item-content">
                  <span className="recent-item-text">{chat.title}</span>
                  <span className="recent-item-date">
                    {formatTimestamp(chat.updatedAt)}
                  </span>
                </div>
                <button
                  className="recent-item-menu"
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  disabled={deletingChatId === chat.id}
                >
                  {deletingChatId === chat.id ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                      className="spinner"
                    >
                      <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M3.5 8a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1-.5-.5" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                    >
                      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                    </svg>
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-profile">
          <div className="profile-avatar">AS</div>
          <div className="default profile-info">
            <div className="profile-name">Alex Student</div>
            <div className="profile-detail">Engineering • Year 3</div>
          </div>
        </div>
      </div>

      <button className="default sidebar-toggle" onClick={onToggle}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {isOpen ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
        </svg>
      </button>
    </>
  );
}
