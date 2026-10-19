// Guarded Firebase init. If the project hasn't configured a Firebase web
// app yet (see .env.example), `auth` stays null and the Login page falls
// back to the backend's dev-mode login instead of crashing on startup.
import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
} from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const authDomain = config.authDomain || "";
export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let auth = null;
if (firebaseConfigured) {
  const app = initializeApp(config);
  auth = getAuth(app);
}

export { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, firebaseSignOut };
