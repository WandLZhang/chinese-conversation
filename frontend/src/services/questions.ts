import { Language, EvaluationResponse } from '../types';
import { auth, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, getDocs } from 'firebase/firestore';

const FUNCTION_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/generate_vocab_question';
const AUDIO_FUNCTION_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/generate_audio_live';

export interface QuestionResponse {
  question: string;
  requires_alternative: boolean;
  target_word: string;
}

export interface AudioResponse {
  audio: string;  // base64 encoded WAV audio
}

export interface Question {
  id: string;
  vocab: string;
  language: Language;
}

export async function generateQuestion(
  word: string, 
  language: Language, 
  cantoneseEntry?: string  // NEW: Pass Firestore cantonese field for alternative detection
): Promise<QuestionResponse> {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      word,
      language,
      cantoneseEntry: cantoneseEntry || '',  // Pass the cantonese example sentence
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate question: ${response.statusText}`);
  }

  return response.json();
}

export async function generateAudio(
  sentence: string,
  language: Language
): Promise<AudioResponse> {
  console.log('Generating audio for:', sentence, 'in', language);
  
  const response = await fetch(AUDIO_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sentence,
      language,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate audio: ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Audio generated, size:', data.audio?.length || 0, 'chars');
  return data;
}

export function playAudio(base64Audio: string) {
  // WAV audio from Gemini Live API
  const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
  return audio.play();
}

export async function getNextQuestion(): Promise<Question | null> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const now = new Date();
  const vocabRef = collection(db, 'vocabulary');
  const q = query(
    vocabRef,
    where('nextReviewMandarin', '<=', now),
    where('nextReviewCantonese', '<=', now)
  );

  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    return null;
  }

  const doc = querySnapshot.docs[0];
  return {
    id: doc.id,
    vocab: doc.data().simplified,
    language: Math.random() < 0.5 ? 'mandarin' : 'cantonese'
  };
}

export async function submitAnswer(
  questionId: string, 
  answer: string, 
  language: Language,
  hadDifficulty: boolean = false
): Promise<EvaluationResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const functionRef = httpsCallable<any, EvaluationResponse>(functions, 'evaluate_answer');
  const result = await functionRef({
    docId: questionId,
    answer,
    language,
    hadDifficulty
  });

  return result.data;
}

export async function updateReviewTime(
  questionId: string, 
  language: Language,
  newReviewTime: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const functionRef = httpsCallable(functions, 'update_review_time');
  await functionRef({
    docId: questionId,
    language,
    newReviewTime
  });
}
