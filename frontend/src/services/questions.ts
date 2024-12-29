import { Language, EvaluationResponse } from '../types';
import { auth, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, getDocs } from 'firebase/firestore';

const FUNCTION_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/generate_vocab_question';

export interface QuestionResponse {
  question: string;
  audio: string;  // base64 encoded audio
}

export interface Question {
  id: string;
  vocab: string;
  language: Language;
}

export async function generateQuestion(word: string, language: Language): Promise<QuestionResponse> {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      word,
      language,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate question: ${response.statusText}`);
  }

  return response.json();
}

export function playAudio(base64Audio: string) {
  const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
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
