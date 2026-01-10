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
 * Validate confidence object
 */
export function validateConfidence(confidence) {
  if (!confidence || typeof confidence !== "object") return null;

  const validLevels = ["High", "Medium", "Low"];
  const level = validLevels.includes(confidence.level)
    ? confidence.level
    : null;
  const score = typeof confidence.score === "number" ? confidence.score : null;

  if (!level || score === null) return null;

  return { level, score };
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
