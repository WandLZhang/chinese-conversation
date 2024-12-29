export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
  signInOptions: string[];
  signInFlow: string;
}

export const firebaseConfig: FirebaseConfig;
