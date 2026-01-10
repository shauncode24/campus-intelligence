import { createContext, useContext, useState, useEffect } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, setState] = useState({
    user: {
      id: null,
      loading: true,
      error: null,
    },
    chats: {
      data: [],
      loading: false,
      error: null,
      currentChatId: null,
    },
    theme: {
      sidebarOpen: true,
    },
  });

  // Initialize user ONCE
  useEffect(() => {
    let storedUserId = localStorage.getItem("campus_intel_user_id");
    if (!storedUserId) {
      storedUserId = `user_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      localStorage.setItem("campus_intel_user_id", storedUserId);
    }

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

  const value = {
    state,
    actions: {
      updateUser,
      updateChats,
      toggleSidebar,
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
