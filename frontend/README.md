# Chinese Conversation Practice App

A mobile-friendly web application for practicing Chinese vocabulary with spaced repetition.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up Firebase configuration:
```bash
# Copy the example config file
cp src/services/firebase.config.example.js src/services/firebase.config.js

# Edit firebase.config.js with your Firebase credentials
```

3. Run the development server:
```bash
npm run dev
```

## Features

- Language selection between Mandarin and Cantonese
- Spaced repetition system for vocabulary practice
- Mobile-friendly interface
- Authentication support
- Progress tracking with difficulty markers

## Development

- Built with React + TypeScript
- Uses Tailwind CSS for styling
- Firebase/Firestore for backend
- Vite for development and building

## Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Firebase Deployment

1. Install Firebase CLI:
```bash
npm install -g firebase-tools
```

2. Login to Firebase:
```bash
firebase login
```

3. Deploy:
```bash
firebase deploy --only hosting:wz-chinese-conversation
```

## Project Structure

- `src/components/` - React components
- `src/services/` - Firebase and other services
  - `firebase.config.js` - Firebase configuration (not in git)
  - `firebase.config.example.js` - Example Firebase configuration
  - `firebase.ts` - Firebase initialization
  - `auth.ts` - Authentication service
  - `scheduler.ts` - Spaced repetition scheduling
- `public/` - Static assets

## Security Note

The following files are excluded from version control for security reasons:

1. `src/services/firebase.config.js` - Contains Firebase credentials
2. `firebase-debug.log*` - Firebase debug logs
3. `.firebase/` - Firebase cache directory

Make sure to:
1. Never commit your Firebase configuration or debug logs
2. Keep your API keys and other credentials secure
3. Use the example config file as a template
4. Set up proper security rules in your Firebase console

## Environment Variables

The following files are used for configuration:

- `src/services/firebase.config.js` - Firebase configuration (not in git)
- `firebase.json` - Firebase hosting configuration
- `firestore.indexes.json` - Firestore indexes configuration
