import { createContext, useContext, useState, useEffect } from "react";
import { getUserId } from "../utils/validation";
const { VITE_PYTHON_RAG_URL } = import.meta.env;

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, setState] = useState({
    user: {
      id: null,
      loading: true,
    },
    chats: {
      data: [],
      loading: false,
      lastFetch: null,
    },
    history: {
      data: [],
      loading: false,
      favoritesOnly: false,
    },
    theme: {
      sidebarOpen: true,
    },
    navigation: {
      pendingQuestion: null,
    },
  });

  // Initialize user ONCE
  useEffect(() => {
    const storedUserId = getUserId();
    setState((prev) => ({
      ...prev,
      user: { id: storedUserId, loading: false, error: null },
    }));
  }, []);

  const updateUser = (updates) => {
    setState((prev) => ({
      ...prev,
      user: { ...prev.user, ...updates },
    }));
  };

  const updateChats = (updates) => {
    setState((prev) => ({
      ...prev,
      chats: { ...prev.chats, ...updates },
    }));
  };

  const toggleSidebar = () => {
    setState((prev) => ({
      ...prev,
      theme: { ...prev.theme, sidebarOpen: !prev.theme.sidebarOpen },
    }));
  };

  const setPendingQuestion = (question) => {
    setState((prev) => ({
      ...prev,
      navigation: { pendingQuestion: question },
    }));
  };

  const fetchChats = async (userId) => {
    if (!userId || state.chats.loading) return;

    setState((prev) => ({
      ...prev,
      chats: { ...prev.chats, loading: true },
    }));

    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/chats/user/${userId}?limit=10`
      );
      const data = await response.json();

      setState((prev) => ({
        ...prev,
        chats: {
          data: data.chats || [],
          loading: false,
          lastFetch: Date.now(),
        },
      }));
    } catch (error) {
      console.error("Failed to fetch chats:", error);
      setState((prev) => ({
        ...prev,
        chats: { ...prev.chats, loading: false },
      }));
    }
  };

  const fetchHistory = async (userId, favoritesOnly = false) => {
    if (!userId || state.history.loading) return;

    setState((prev) => ({
      ...prev,
      history: { ...prev.history, loading: true },
    }));

    try {
      const url = favoritesOnly
        ? `${VITE_PYTHON_RAG_URL}/history/${userId}?limit=100&favorites_only=true`
        : `${VITE_PYTHON_RAG_URL}/history/${userId}?limit=100`;

      const response = await fetch(url);
      const data = await response.json();

      setState((prev) => ({
        ...prev,
        history: {
          data: data.history || [],
          loading: false,
          favoritesOnly,
        },
      }));
    } catch (error) {
      console.error("Failed to fetch history:", error);
      setState((prev) => ({
        ...prev,
        history: { ...prev.history, loading: false },
      }));
    }
  };

  const updateHistoryItem = (historyId, updates) => {
    setState((prev) => ({
      ...prev,
      history: {
        ...prev.history,
        data: prev.history.data.map((item) =>
          item.id === historyId ? { ...item, ...updates } : item
        ),
      },
    }));
  };

  const removeHistoryItem = (historyId) => {
    setState((prev) => ({
      ...prev,
      history: {
        ...prev.history,
        data: prev.history.data.filter((item) => item.id !== historyId),
      },
    }));
  };

  const updateChatTitle = (chatId, newTitle) => {
    setState((prev) => ({
      ...prev,
      chats: {
        ...prev.chats,
        data: prev.chats.data.map((chat) =>
          chat.id === chatId ? { ...chat, title: newTitle } : chat
        ),
      },
    }));
  };

  const removeChat = (chatId) => {
    setState((prev) => ({
      ...prev,
      chats: {
        ...prev.chats,
        data: prev.chats.data.filter((chat) => chat.id !== chatId),
      },
    }));
  };

  const value = {
    state,
    actions: {
      updateUser,
      fetchChats,
      fetchHistory,
      updateHistoryItem,
      removeHistoryItem,
      updateChatTitle,
      removeChat,
      toggleSidebar,
      setPendingQuestion,
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
}
