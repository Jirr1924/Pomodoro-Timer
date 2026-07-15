import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "cozypomo-timer",
  appId: "1:497085990693:web:6378bd51d2896bebf5fccc",
  apiKey: "AIzaSyDuBf3hdN-cZg07Wz3JSEcxdH9gsYKXwgk",
  authDomain: "cozypomo-timer.firebaseapp.com",
  storageBucket: "cozypomo-timer.firebasestorage.app",
  messagingSenderId: "497085990693",
  measurementId: "G-6Y1P59RVEL"
};

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app, "(default)");
export const googleProvider = new GoogleAuthProvider();
