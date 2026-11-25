import { createContext, useContext, useState, useEffect } from "react";
import { auth, db } from "../app/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { ensureSignedIn } from "../utils/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Turn a Firebase user into the app's user (also used right after a guest signs up)
  const applyUser = async (firebaseUser) => {
    if (firebaseUser.isAnonymous) {
      setUser({
        uid: firebaseUser.uid,
        email: null,
        displayName: "Guest",
        role: "user",
        isAnonymous: true,
        createdAt: new Date(),
      });
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    // Admin status is the server-granted `admin` custom claim on the ID
    // token. It is NOT read from the Firestore profile, which a user could
    // edit. (The UI uses this only to show/hide things; the backend and the
    // Firestore rules enforce it independently.)
    const tokenResult = await firebaseUser.getIdTokenResult();
    const adminClaim = tokenResult.claims.admin === true;

    // Profile (display name etc.) from Firestore
    let userData;
    try {
      const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
      userData = userDoc.data();
    } catch (error) {
      console.error("Failed to load user profile:", error);
    }

    setUser({
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: userData?.displayName || firebaseUser.email.split("@")[0],
      role: adminClaim ? "admin" : "user",
      isAnonymous: false,
      createdAt: userData?.createdAt || new Date(),
    });

    setIsAdmin(adminClaim);
    setLoading(false);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        // Nobody signed in: give the visitor an anonymous (guest) Firebase
        // account so the backend can verify a real uid. Stay in `loading`
        // until that account arrives via the next auth-state callback.
        setUser(null);
        setIsAdmin(false);
        ensureSignedIn().catch((error) => {
          console.error("Guest sign-in failed:", error);
          setLoading(false);
        });
        return;
      }

      await applyUser(firebaseUser);
    });

    return unsubscribe;
  }, []);

  const login = async (email, password) => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  };

  const signup = async (email, password, displayName) => {
    // A guest who signs up KEEPS their chats and history: the guest account is upgraded in place
    // (same uid) instead of a second account being created.
    const guest = auth.currentUser && auth.currentUser.isAnonymous ? auth.currentUser : null;
    const result = guest
      ? await linkWithCredential(guest, EmailAuthProvider.credential(email, password))
      : await createUserWithEmailAndPassword(auth, email, password);

    // Create user profile in Firestore
    await setDoc(doc(db, "users", result.user.uid), {
      email,
      displayName,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (guest) {
      await result.user.getIdToken(true);
      await applyUser(result.user);
    }

    return result.user;
  };

  const logout = async () => {
    await signOut(auth);
  };

  const value = {
    user,
    isAdmin,
    loading,
    login,
    signup,
    logout,
    // Guests (anonymous Firebase accounts) are NOT "logged in"
    isLoggedIn: !!user && !user.isAnonymous,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
