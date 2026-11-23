// src/utils/validation.js

import { storage } from "./storage";

export function parseTimestamp(timestamp) {
  if (!timestamp) return null;

  try {
    if (timestamp.toDate && typeof timestamp.toDate === "function") {
      return timestamp.toDate();
    }

    if (timestamp._seconds) {
      return new Date(timestamp._seconds * 1000);
    }

    if (timestamp.seconds) {
      return new Date(timestamp.seconds * 1000);
    }

    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  } catch (error) {
    console.error("Error parsing timestamp:", error);
    return null;
  }
}

/**
 * Safely get user ID
 */
export function getUserId() {
  try {
    let userId = storage.getUserId();

    if (!userId || typeof userId !== "string") {
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      storage.setUserId(userId);
    }

    return userId;
  } catch (error) {
    console.error("localStorage not available:", error);
    return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * The page number a human should see for a source (1-based).
 *
 * New sources carry an explicit `displayPage` (1-based). Older records (saved
 * history, cached FAQ answers, stored chat messages) only have the 0-based
 * `pageNumber` / `page`, so those get +1. Returns null when unknown. Never use
 * `source.page || ...`: page index 0 is falsy.
 */
export function getDisplayPage(source) {
  if (!source) return null;
  if (Number.isInteger(source.displayPage)) return source.displayPage;
  const legacy = Number.isInteger(source.pageNumber)
    ? source.pageNumber
    : source.page;
  return Number.isInteger(legacy) ? legacy + 1 : null;
}

/**
 * Validate sources array
 */
export function validateSources(sources) {
  if (!Array.isArray(sources)) return [];

  return sources.filter(
    (source) =>
      source &&
      typeof source === "object" &&
      typeof source.documentName === "string"
  );
}
