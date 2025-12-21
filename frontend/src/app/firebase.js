import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// PASTE YOUR FIREBASE CONFIG HERE (from Step 3.5)
const firebaseConfig = {
  apiKey: "AIzaSyBeF95cwBucOlC5102dQyhBt2Tjfzm0jpg",
  authDomain: "campus-intel-7e594.firebaseapp.com",
  projectId: "campus-intel-7e594",
  storageBucket: "campus-intel-7e594.firebasestorage.app",
  messagingSenderId: "285731805790",
  appId: "1:285731805790:web:3edb516b9d2a56d35332cf",
  measurementId: "G-F1DH2EWZP3",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
