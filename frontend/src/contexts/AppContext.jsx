import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useAuth } from "./AuthContext";

const { VITE_PYTHON_RAG_URL } = import.meta.env;

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user, isLoggedIn } = useAuth();

  const [state, setState] = useState({
    user: {
      id: null,
      displayName: "Guest",
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
  const isFetchingChats = useRef(false);

  // Generate consistent user ID based on auth state
  const generateUserId = useCallback(() => {
    if (isLoggedIn && user) {
      return user.uid;
    } else {
      let guestId = localStorage.getItem("campus_intel_guest_id");
      if (!guestId) {
        guestId = `guest_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        localStorage.setItem("campus_intel_guest_id", guestId);
      }
      return guestId;
    }
  }, [isLoggedIn, user]);

  // Update user state when auth changes
  useEffect(() => {
    const userId = generateUserId();
    const displayName = isLoggedIn && user ? user.displayName : "Guest";

    setState((prev) => ({
      ...prev,
      user: { id: userId, displayName, loading: false },
    }));
  }, [isLoggedIn, user, generateUserId]);

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

      // ✅ CRITICAL FIX: Prevent concurrent fetches
      if (isFetchingChats.current && !forceRefresh) {
        console.log("⏸️ Fetch already in progress, skipping...");
        return;
      }

      const key = `chats-${userId}`;

      if (pendingRequests.current.has(key) && !forceRefresh) {
        return pendingRequests.current.get(key);
      }

      // ✅ FIX: Check if data is fresh (within last 5 seconds)
      const now = Date.now();
      if (
        state.chats.lastFetch &&
        now - state.chats.lastFetch < 5000 &&
        !forceRefresh
      ) {
        console.log("✅ Using cached chats (fresh data)");
        return;
      }

      isFetchingChats.current = true;

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
          isFetchingChats.current = false;
        });

      pendingRequests.current.set(key, promise);
      return promise;
    },
    [] // ✅ FIX: Remove state.chats.lastFetch dependency
  );

  const fetchHistory = useCallback(
    async (userId, favoritesOnly = false) => {
      if (!userId) return;

      const key = `history-${userId}-${favoritesOnly}`;

      if (pendingRequests.current.has(key)) {
        return pendingRequests.current.get(key);
      }

      // ✅ FIX: Only skip if we have data AND same filter
      if (
        state.history.data.length > 0 &&
        state.history.favoritesOnly === favoritesOnly
      ) {
        return;
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
    [] // ✅ FIX: Remove dependencies
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
          chat.id === chatId
            ? { ...chat, title: newTitle, updatedAt: new Date() }
            : chat
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
