// src/utils/errors.js
import toast from "react-hot-toast";
import { recentServerRef } from "./api";
import { refFromMessage, withRef } from "./errorRef";

export const ErrorType = {
  NETWORK: "NETWORK",
  TIMEOUT: "TIMEOUT",
  VALIDATION: "VALIDATION",
  AUTH: "AUTH",
  NOT_FOUND: "NOT_FOUND",
  SERVER: "SERVER",
  UNKNOWN: "UNKNOWN",
};

function classifyError(error) {
  if (!navigator.onLine) return ErrorType.NETWORK;
  if (error.name === "AbortError") return null;
  if (error.name === "TimeoutError") return ErrorType.TIMEOUT;
  if (error.status === 401 || error.status === 403) return ErrorType.AUTH;
  if (error.status === 404) return ErrorType.NOT_FOUND;
  if (error.status >= 500) return ErrorType.SERVER;
  if (error.status >= 400) return ErrorType.VALIDATION;
  return ErrorType.UNKNOWN;
}

function getUserMessage(errorType, error) {
  const messages = {
    [ErrorType.NETWORK]: "No internet connection. Please check your network.",
    [ErrorType.TIMEOUT]: "The server is taking too long. Please try again in a moment.",
    [ErrorType.AUTH]: "You need to log in to perform this action.",
    [ErrorType.NOT_FOUND]: "The requested resource was not found.",
    [ErrorType.SERVER]: "Server error. Please try again later.",
    [ErrorType.VALIDATION]: error.message || "Invalid request.",
    [ErrorType.UNKNOWN]: "Something went wrong. Please try again.",
  };

  return messages[errorType] || messages[ErrorType.UNKNOWN];
}

/** The reference of a server failure: carried by the error, written in its message, or the last failed call. */
export function errorRef(error, now = Date.now()) {
  if (error && typeof error.ref === "string" && error.ref) return error.ref;
  return refFromMessage(error && error.message) || recentServerRef(now);
}

/**
 * Handle error with toast notification
 */
export function handleError(error, options = {}) {
  const { silent = false, customMessage } = options;

  if (import.meta.env.DEV) {
    console.error("Error caught:", error);
  }

  const errorType = classifyError(error);

  if (!errorType) return null;

  let message = customMessage || getUserMessage(errorType, error);
  // Quote the reference of a failed server call so it can be found in the server's logs
  if (errorType === ErrorType.SERVER || errorType === ErrorType.TIMEOUT || errorType === ErrorType.UNKNOWN) {
    message = withRef(message, errorRef(error));
  }

  if (!silent) {
    toast.error(message, {
      duration: 4000,
      position: "top-right",
    });
  }

  return errorType;
}

/**
 * Async error wrapper
 */
export async function withErrorHandling(fn, options = {}) {
  try {
    return await fn();
  } catch (error) {
    handleError(error, options);
    throw error;
  }
}
