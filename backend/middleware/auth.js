import admin from "firebase-admin";
// Importing this module guarantees the default Firebase Admin app is initialised.
import "../config/firebaseAdmin.js";

/**
 * Require a valid Firebase ID token (`Authorization: Bearer <token>`).
 *
 * On success sets:
 *   req.uid       - the verified Firebase uid (the ONLY trusted user identity)
 *   req.authToken - the raw bearer token, so it can be forwarded to the Python
 *                   RAG service, which verifies it again on its own.
 *
 * Never read a user id from req.body / req.query / req.params for authorisation.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (!/^Bearer$/i.test(scheme || "") || !token) {
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.authToken = token;
    return next();
  } catch (error) {
    // Never log the token itself.
    console.warn(`Auth rejected: ${error.code || error.name}`);
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
