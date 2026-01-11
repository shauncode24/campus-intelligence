import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
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

  const pendingRequests = useRef(new Map());

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

  const fetchChats = useCallback(
    async (userId, forceRefresh = false) => {
      if (!userId) return;

      const key = `chats-${userId}`;

      // Return existing promise if already fetching
      if (pendingRequests.current.has(key)) {
        return pendingRequests.current.get(key);
      }

      // Don't fetch if already loading
      if (state.chats.loading && !forceRefresh) return;

      setState((prev) => ({
        ...prev,
        chats: { ...prev.chats, loading: true },
      }));

      const promise = fetch(
        `${VITE_PYTHON_RAG_URL}/chats/user/${userId}?limit=10`
      )
        .then((response) => response.json())
        .then((data) => {
          setState((prev) => ({
            ...prev,
            chats: {
              data: data.chats || [],
              loading: false,
              lastFetch: Date.now(),
            },
          }));
          return data;
        })
        .catch((error) => {
          console.error("Failed to fetch chats:", error);
          setState((prev) => ({
            ...prev,
            chats: { ...prev.chats, loading: false },
          }));
          throw error;
        })
        .finally(() => {
          pendingRequests.current.delete(key);
        });

      pendingRequests.current.set(key, promise);
      return promise;
    },
    [state.chats.loading]
  );

  const fetchHistory = useCallback(
    async (userId, favoritesOnly = false) => {
      if (!userId) return;

      const key = `history-${userId}-${favoritesOnly}`;

      // Return existing promise if already fetching
      if (pendingRequests.current.has(key)) {
        return pendingRequests.current.get(key);
      }

      if (state.history.loading) return;

      setState((prev) => ({
        ...prev,
        history: { ...prev.history, loading: true },
      }));

      const url = favoritesOnly
        ? `${VITE_PYTHON_RAG_URL}/history/${userId}?limit=100&favorites_only=true`
        : `${VITE_PYTHON_RAG_URL}/history/${userId}?limit=100`;

      const promise = fetch(url)
        .then((response) => response.json())
        .then((data) => {
          setState((prev) => ({
            ...prev,
            history: {
              data: data.history || [],
              loading: false,
              favoritesOnly,
            },
          }));
          return data;
        })
        .catch((error) => {
          console.error("Failed to fetch history:", error);
          setState((prev) => ({
            ...prev,
            history: { ...prev.history, loading: false },
          }));
          throw error;
        })
        .finally(() => {
          pendingRequests.current.delete(key);
        });

      pendingRequests.current.set(key, promise);
      return promise;
    },
    [state.history.loading]
  );

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
    console.log(`🗑️ Removing chat ${chatId} from state`);
    setState((prev) => ({
      ...prev,
      chats: {
        ...prev.chats,
        data: prev.chats.data.filter((chat) => {
          const shouldKeep = chat.id !== chatId;
          if (!shouldKeep) {
            console.log(`   Filtering out chat: ${chat.id} (${chat.title})`);
          }
          return shouldKeep;
        }),
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
