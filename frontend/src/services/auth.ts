import { getAuth, signInWithPopup, GoogleAuthProvider, Auth } from "firebase/auth";
import { app } from "./firebase";

const auth: Auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Configure Google Sign-In
provider.setCustomParameters({
  login_hint: 'wzhybrid@gmail.com'
});

export const signIn = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const email = result.user.email?.toLowerCase();
    
    if (email !== 'wzhybrid@gmail.com') {
      console.error('Invalid email:', email);
      await auth.signOut();
      throw new Error('Please sign in with wzhybrid@gmail.com');
    }
    
    return result.user;
  } catch (error: any) {
    console.error('Auth error:', error);
    throw error;
  }
};

export const onAuthChange = (callback: (user: any) => void) => {
  return auth.onAuthStateChanged(callback);
};
