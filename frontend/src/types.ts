export type Language = 'mandarin' | 'cantonese';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface VocabCard {
  id: string;
  word: string;
  nextReview: Date;
  interval: number;
  easeFactor: number;
  reviews: number;
  language: Language;
}

export interface VocabEntry {
  id: string;
  simplified: string;  // simplified Chinese
  mandarin: string;    // mandarin sentence
  cantonese: string;   // cantonese sentence
  timestamp: Date;
  language: Language;
  nextReviewMandarin?: { toDate(): Date };  // Firestore Timestamp
  nextReviewCantonese?: { toDate(): Date }; // Firestore Timestamp
  [key: string]: any; // Allow dynamic review time fields
}

export interface QuestionData {
  question: string;
  audio: string;  // base64 encoded audio
  word: string;
  language: Language;
  requires_alternative: boolean;  // NEW: whether colloquial alternative was used
  target_word: string;  // NEW: the actual word used in the question
}

export interface Evaluation {
  fluent: boolean;
  meaningful_usage: boolean;
  has_fillers: boolean;
  romanization: string;
  improved_answer?: string;
  feedback: string;
}

export interface ReviewIntervals {
  DIFFICULTY: {
    IMMEDIATE: number;  // 5 minutes
    SHORT: number;      // 15 minutes
    MEDIUM: number;     // 30 minutes
  };
  SUCCESS: {
    INITIAL: number[];    // [60, 240] (1h, 4h)
    SUBSEQUENT: number[]; // [1440, 4320, 10080] (1d, 3d, 7d)
  };
}

export interface EvaluationResponse {
  success: boolean;
  evaluation: Evaluation;
  nextReview: string;
  intervals: ReviewIntervals;
}
