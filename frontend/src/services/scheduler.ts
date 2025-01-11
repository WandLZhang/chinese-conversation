import { Language } from '../types';

const EVALUATE_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/evaluate_answer';
const UPDATE_TIME_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/update_review_time';
const MARK_MASTERED_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/mark_word_mastered';
const UNMARK_MASTERED_URL = MARK_MASTERED_URL; // Uses same endpoint with different params

export interface AnswerEvaluation {
  fluent: boolean;
  meaningful_usage: boolean;
  has_fillers: boolean;
  romanization: string;
  improved_answer?: string;
  feedback: string;
}

export interface EvaluationResponse {
  success: boolean;
  evaluation: AnswerEvaluation;
  nextReview: { seconds: number; nanoseconds: number };  // Firestore Timestamp
  intervals: {
    DIFFICULTY: {
      IMMEDIATE: number;
      SHORT: number;
      MEDIUM: number;
    };
    SUCCESS: {
      INITIAL: number[];
      SUBSEQUENT: number[];
    };
  };
}

export async function evaluateAnswer(
  docId: string,
  language: Language,
  answer: string,
  hadDifficulty: boolean = false,
  generatedQuestion?: string
): Promise<{ evaluation: AnswerEvaluation; nextReview: { seconds: number; nanoseconds: number } }> {
  const response = await fetch(EVALUATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      docId,
      language,
      answer,
      hadDifficulty,
      generatedQuestion
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to evaluate answer: ${error.error || response.statusText}`);
  }

  return response.json();
}

export async function markWordMastered(
  docId: string,
  language: Language,
  mastered: boolean = true // Add parameter to control mastered state
): Promise<{ success: boolean }> {
  const response = await fetch(MARK_MASTERED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      docId,
      language, 
      mastered,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to mark word as mastered: ${error.error || response.statusText}`);
  }

  return response.json();
}

export async function updateReviewTime(
  docId: string,
  language: Language,
  newReviewTime: string
): Promise<{ nextReview: { seconds: number; nanoseconds: number } }> {
  const response = await fetch(UPDATE_TIME_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      docId,
      language,
      newReviewTime,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to update review time: ${error.error || response.statusText}`);
  }

  return response.json();
}
