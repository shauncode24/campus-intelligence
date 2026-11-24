/**
 * Removal of an uploaded file from the Supabase storage bucket.
 *
 * Needs a server-side key with delete rights (SUPABASE_SERVICE_ROLE_KEY in
 * backend/.env). That key must NEVER be sent to the browser. If it is not
 * configured the file is left in place and the caller is told so; deleting a
 * document must not hang on this.
 */
import { randomBytes } from "node:crypto";
import { validateFileUrl } from "../utils/fileUrl.js";

const DEFAULT_HOST = "qqdonjhgvuyjfusplexf.supabase.co";
const PUBLIC_PREFIX = "/storage/v1/object/public/documents/";
const TIMEOUT_MS = 15000;

/**
 * Ask Supabase for a one-time signed upload URL for a NEW object in the bucket.
 *
 * The browser used to upload with the public anon key, which only works if the bucket
 * lets anyone write. With signed uploads the bucket can deny all anonymous writes: only
 * a verified admin can obtain a token (this runs behind requireAdmin), the token is for
 * one path, expires, and cannot overwrite an existing file (no `x-upsert`).
 *
 * @param {string} originalName the file name the admin picked (only used to build a safe path)
 * @returns {Promise<{ ok: true, path: string, token: string, publicUrl: string } | { ok: false, status: number, reason: string }>}
 */
export async function createSignedUploadTarget(originalName) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return { ok: false, status: 503, reason: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server" };
  }
  const host = (process.env.ALLOWED_FILE_HOSTS || DEFAULT_HOST).split(",")[0].trim();
  const origin = `https://${host}`;

  const safeName = String(originalName || "document.pdf")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .slice(-120);
  // random part: the path cannot be guessed or collide with an existing object
  const path = `${Date.now()}_${randomBytes(6).toString("hex")}_${safeName}`;

  try {
    const response = await fetch(`${origin}/storage/v1/object/upload/sign/documents/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, status: 502, reason: `Storage returned HTTP ${response.status}` };
    }
    const body = await response.json().catch(() => ({}));
    // Supabase answers { url: "/object/upload/sign/documents/<path>?token=<jwt>" } (older: { token })
    let token = typeof body.token === "string" ? body.token : null;
    if (!token && typeof body.url === "string") {
      token = new URL(body.url, origin).searchParams.get("token");
    }
    if (!token) return { ok: false, status: 502, reason: "Storage did not return an upload token" };
    return {
      ok: true,
      path,
      token,
      publicUrl: `${origin}${PUBLIC_PREFIX}${encodeURIComponent(path)}`,
    };
  } catch (error) {
    return { ok: false, status: 502, reason: `Storage request failed (${error.name})` };
  }
}

/**
 * @param {string} fileUrl the stored public URL of the document
 * @returns {Promise<{ deleted: boolean, reason?: string }>}
 */
export async function deleteDocumentFile(fileUrl) {
  // Only ever call storage for URLs that point at our own bucket.
  const check = validateFileUrl(fileUrl);
  if (!check.ok) {
    return { deleted: false, reason: `Stored file URL not recognised (${check.reason})` };
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return {
      deleted: false,
      reason: "SUPABASE_SERVICE_ROLE_KEY is not configured; the file was left in storage",
    };
  }

  const url = new URL(fileUrl);
  const objectPath = url.pathname.slice(PUBLIC_PREFIX.length); // still percent-encoded
  const target = `${url.origin}/storage/v1/object/documents/${objectPath}`;

  try {
    const response = await fetch(target, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 404 = already gone, which is the state we want
    if (response.ok || response.status === 404) return { deleted: true };
    return { deleted: false, reason: `Storage returned HTTP ${response.status}` };
  } catch (error) {
    return { deleted: false, reason: `Storage request failed (${error.name})` };
  }
}
