// src/utils/storage.js

const STORAGE_KEYS = {
  USER_ID: "campus_intel_user_id",
  THEME: "campus_intel_theme",
  SIDEBAR_PREFERENCE: "campus_intel_sidebar_open",
};

export const storage = {
  getUserId: () => {
    return localStorage.getItem(STORAGE_KEYS.USER_ID);
  },

  setUserId: (id) => {
    localStorage.setItem(STORAGE_KEYS.USER_ID, id);
  },

  getTheme: () => {
    return localStorage.getItem(STORAGE_KEYS.THEME) || "light";
  },

  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  },

  getSidebarPreference: () => {
    const pref = localStorage.getItem(STORAGE_KEYS.SIDEBAR_PREFERENCE);
    return pref === null ? true : pref === "true";
  },

  setSidebarPreference: (isOpen) => {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_PREFERENCE, String(isOpen));
  },
};
