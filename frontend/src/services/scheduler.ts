import { Language } from '../types';

const EVALUATE_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/evaluate_answer';
const UPDATE_TIME_URL = 'https://us-central1-wz-data-catalog-demo.cloudfunctions.net/update_review_time';

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
  nextReview: string;
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
): Promise<{ evaluation: AnswerEvaluation; nextReview: string }> {
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

export async function updateReviewTime(
  docId: string,
  language: Language,
  newReviewTime: string
): Promise<void> {
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
}
