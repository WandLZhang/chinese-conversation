// Copy this file to firebase.config.js and fill in your Firebase configuration
export const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "your-messaging-sender-id",
  appId: "your-app-id",
  measurementId: "your-measurement-id",
  // Enable popup sign-in
  signInOptions: ['google.com'],
  signInFlow: 'popup'
};
