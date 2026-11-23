/**
 * Validation of document file URLs.
 *
 * A stored `fileUrl` is later downloaded by the server, so it must only ever
 * point at our own storage bucket (otherwise an admin account, or anyone who
 * could write a document record, could make the server fetch internal URLs).
 * Keep in sync with backend/python/utils/file_security.py, which enforces the
 * same rules again at download time.
 */
const DEFAULT_ALLOWED_HOSTS = "qqdonjhgvuyjfusplexf.supabase.co";

// Supabase public-object path for the "documents" bucket
const REQUIRED_PATH_PREFIX = "/storage/v1/object/public/documents/";
const MAX_URL_LENGTH = 2048;

function allowedHosts() {
  return (process.env.ALLOWED_FILE_HOSTS || DEFAULT_ALLOWED_HOSTS)
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {unknown} value
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateFileUrl(value) {
  if (typeof value !== "string" || !value || value.length > MAX_URL_LENGTH) {
    return { ok: false, reason: "File URL is missing or too long" };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "File URL is malformed" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "File URL must use https" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "File URL must not contain credentials" };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, reason: "File URL must use the default port" };
  }
  if (!allowedHosts().includes(url.hostname.toLowerCase())) {
    return { ok: false, reason: "File URL host is not allowed" };
  }
  if (!url.pathname.startsWith(REQUIRED_PATH_PREFIX)) {
    return {
      ok: false,
      reason: "File URL path is not inside the documents bucket",
    };
  }

  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, reason: "File URL is malformed" };
  }
  if (decoded.replace(/\\/g, "/").split("/").includes("..")) {
    return { ok: false, reason: "File URL path is not allowed" };
  }

  return { ok: true };
}
