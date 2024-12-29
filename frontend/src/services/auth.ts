import { getAuth, signInWithPopup, GoogleAuthProvider, Auth } from "firebase/auth";
import { app } from "./firebase";

const auth: Auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Configure provider to select wzhybrid@gmail.com account
provider.setCustomParameters({
  login_hint: 'wzhybrid@gmail.com',
  prompt: 'select_account'
});

// Add scopes if needed
provider.addScope('https://www.googleapis.com/auth/userinfo.email');

export const signIn = async () => {
  try {
    // Clear any existing auth state
    await auth.signOut();
    
    // Attempt sign in with popup
    const result = await signInWithPopup(auth, provider);
    
    // Verify email
    if (result.user.email !== 'wzhybrid@gmail.com') {
      await auth.signOut();
      throw new Error('Please sign in with wzhybrid@gmail.com');
    }
    
    return result.user;
  } catch (error: any) {
    console.error("Auth error:", error);
    // Provide more specific error messages
    if (error.code === 'auth/popup-blocked') {
      throw new Error('Please allow popups for this site');
    } else if (error.code === 'auth/cancelled-popup-request') {
      throw new Error('Sign in was cancelled');
    } else if (error.code === 'auth/popup-closed-by-user') {
      throw new Error('Sign in window was closed');
    } else {
      throw error;
    }
  }
};

export const onAuthChange = (callback: (user: any) => void) => {
  return auth.onAuthStateChanged(callback);
};
