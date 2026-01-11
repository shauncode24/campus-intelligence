import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Sidebar.css";
import { useApp } from "../contexts/AppContext";
import { useAuth } from "../contexts/AuthContext";
import { parseTimestamp } from "../utils/validation";
import { handleError } from "../utils/errors";
import ChatListSkeleton from "../components/Loading/ChatListSkeleton";
import toast from "react-hot-toast";

const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function Sidebar({ isOpen, onToggle, currentChatId }) {
  const navigate = useNavigate();
  const { state, actions } = useApp();
  const { isLoggedIn } = useAuth();
  const userId = state.user.id;
  const displayName = state.user.displayName;
  const recentChats = state.chats.data;
  const loadingChats = state.chats.loading;
  const savedCount = state.history.data.filter((h) => h.favorite).length;

  const [deletingChatId, setDeletingChatId] = useState(null);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editedTitle, setEditedTitle] = useState("");

  useEffect(() => {
    if (userId && state.chats.data.length === 0) {
      // ✅ Only fetch if we have no chats
      actions.fetchChats(userId);
    }
    if (isLoggedIn && state.history.data.length === 0) {
      // ✅ Only fetch if we have no history
      actions.fetchHistory(userId, true);
    }
  }, [userId]); // ✅ Only depend on userId

  const handleNewChat = async () => {
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
        await actions.fetchChats(userId);
        navigate(`/student?chat=${data.chatId}`);
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

    setDeletingChatId(chatId);

    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/chats/${chatId}?userId=${userId}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (data.success) {
        actions.removeChat(chatId);
        toast.success("Chat deleted successfully");

        if (currentChatId === chatId) {
          await handleNewChat();
        }
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to delete chat" });
    } finally {
      setDeletingChatId(null);
    }
  };

  const handleChatClick = (chatId) => {
    if (editingChatId === chatId) return;
    navigate(`/student?chat=${chatId}`);
  };

  const handleStartEdit = (chatId, currentTitle, e) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditedTitle(currentTitle);
  };

  const handleSaveEdit = async (chatId, e) => {
    e?.stopPropagation();

    if (!editedTitle.trim()) {
      toast.error("Chat name cannot be empty");
      return;
    }

    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/chats/${chatId}/user/${userId}/title`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: editedTitle.trim() }),
        }
      );

      const data = await response.json();

      if (data.success) {
        actions.updateChatTitle(chatId, editedTitle.trim());
        toast.success("Chat name updated");
        setEditingChatId(null);
        setEditedTitle("");
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to update chat name" });
    }
  };

  const handleCancelEdit = (e) => {
    e?.stopPropagation();
    setEditingChatId(null);
    setEditedTitle("");
  };

  const handleKeyPress = (chatId, e) => {
    if (e.key === "Enter") {
      handleSaveEdit(chatId, e);
    } else if (e.key === "Escape") {
      handleCancelEdit(e);
    }
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

  const handleSavedClick = () => {
    if (!isLoggedIn) {
      toast.error("Please sign in to access saved answers");
      navigate("/user-login");
      return;
    }
    navigate("/saved-answers");
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
      count: isLoggedIn ? savedCount : 0,
      onClick: handleSavedClick,
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
          <div className="sidebar-section-label">RECENT</div>

          {loadingChats ? (
            <ChatListSkeleton count={5} />
          ) : recentChats.length === 0 ? (
            <div className="sidebar-empty">
              <p style={{ fontSize: "13px", color: "#5f6368", padding: "8px" }}>
                No chats yet. Click "New Chat" to start!
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
                  {editingChatId === chat.id ? (
                    <input
                      type="text"
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      onKeyDown={(e) => handleKeyPress(chat.id, e)}
                      onBlur={(e) => handleSaveEdit(chat.id, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="chat-title-input"
                      autoFocus
                      maxLength={50}
                    />
                  ) : (
                    <>
                      <span className="recent-item-text">{chat.title}</span>
                      <span className="recent-item-date">
                        {formatTimestamp(chat.updatedAt)}
                      </span>
                    </>
                  )}
                </div>

                <div className="recent-item-actions">
                  {editingChatId === chat.id ? (
                    <>
                      <button
                        className="recent-item-menu edit-action"
                        onClick={(e) => handleSaveEdit(chat.id, e)}
                        title="Save"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425z" />
                        </svg>
                      </button>
                      <button
                        className="recent-item-menu edit-action"
                        onClick={handleCancelEdit}
                        title="Cancel"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="recent-item-menu"
                        onClick={(e) => handleStartEdit(chat.id, chat.title, e)}
                        title="Edit name"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z" />
                          <path
                            fillRule="evenodd"
                            d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"
                          />
                        </svg>
                      </button>
                      <button
                        className="recent-item-menu delete-btn"
                        onClick={(e) => handleDeleteChat(chat.id, e)}
                        disabled={deletingChatId === chat.id}
                        title="Delete chat"
                      >
                        {deletingChatId === chat.id ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                            className="spinner"
                          >
                            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M3.5 8a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1-.5-.5" />
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                            <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                          </svg>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-profile">
          <div className="profile-avatar">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="default profile-info">
            <div className="profile-name">{displayName}</div>
            <div className="profile-detail">
              {isLoggedIn ? "Logged In" : "Guest User"}
            </div>
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
