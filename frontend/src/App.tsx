import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs, Timestamp, where } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './services/firebase';
import { signIn, onAuthChange } from './services/auth';
import { evaluateAnswer, updateReviewTime, type AnswerEvaluation } from './services/scheduler';
import { generateQuestion, playAudio } from './services/questions';
import { VocabEntry, Language, QuestionData } from './types';
import { SpeakerWaveIcon } from '@heroicons/react/24/solid';

function LoadingSpinner() {
  return (
    <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-500 inline-block mr-2" />
  );
}

function EvaluationResult({ 
  evaluation, 
  nextReview, 
  onUpdateTime 
}: { 
  evaluation: AnswerEvaluation; 
  nextReview: string;
  onUpdateTime: (newTime: string) => void;
}) {
  // Times from Firestore are already in Eastern Time
  const reviewDate = new Date(nextReview);
  const [selectedTime, setSelectedTime] = useState(nextReview);

  // Format for datetime-local input
  const inputValue = reviewDate.toISOString().slice(0, 16);

  // Handle time change
  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = new Date(e.target.value);
    setSelectedTime(newDate.toISOString());
  };

  // Format display time (already in Eastern Time)
  const displayTime = reviewDate.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
      <div className="mb-4">
        <h3 className="font-bold text-lg mb-2">Evaluation Results</h3>
        <p className="mb-2 chinese-text">{evaluation.romanization}</p>
        {evaluation.improved_answer && (
          <div className="mb-2">
            <p className="text-sm text-gray-600">Improved version:</p>
            <p className="chinese-text">{evaluation.improved_answer}</p>
          </div>
        )}
        <p className="text-sm text-gray-600">{evaluation.feedback}</p>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="flex-grow">
          <label className="block text-sm text-gray-600 mb-1">Next Review</label>
          <div>
            <div className="text-sm text-gray-600 mb-1">
              {displayTime}
            </div>
            <input
              type="datetime-local"
              value={inputValue}
              onChange={handleTimeChange}
              className="border rounded px-2 py-1 w-full"
            />
          </div>
        </div>
        <button
          onClick={() => onUpdateTime(selectedTime)}
          disabled={selectedTime === nextReview}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          Update
        </button>
      </div>
    </div>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>('mandarin');
  const [currentVocab, setCurrentVocab] = useState<VocabEntry | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [userInput, setUserInput] = useState('');
  const [hadDifficulty, setHadDifficulty] = useState(false);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [evaluation, setEvaluation] = useState<AnswerEvaluation | null>(null);
  const [nextReview, setNextReview] = useState<string | null>(null);
  const [showWordList, setShowWordList] = useState(false);
  const [scheduledWords, setScheduledWords] = useState<VocabEntry[]>([]);
  const [newWords, setNewWords] = useState<VocabEntry[]>([]);

  // Fetch word lists when language changes or modal opens
  useEffect(() => {
    if (showWordList && user) {
      const fetchWordLists = async () => {
        setIsLoading(true);
        const vocabRef = collection(db, 'vocabulary');
        const nextReviewField = `nextReview${language.charAt(0).toUpperCase() + language.slice(1)}`;
        
        try {
          // Fetch scheduled words (both overdue and upcoming)
          const scheduledQuery = query(
            vocabRef,
            where(nextReviewField, '!=', null),
            orderBy(nextReviewField),
            limit(50)
          );
          const scheduledSnapshot = await getDocs(scheduledQuery);
          const scheduledWordsData = scheduledSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              simplified: data.simplified,
              mandarin: data.mandarin,
              cantonese: data.cantonese,
              timestamp: data.timestamp,
              language: data.language,
              ...data
            } as VocabEntry;
          });
          setScheduledWords(scheduledWordsData);

          // Fetch new words (words without a next review time)
          const allWordsQuery = query(
            vocabRef,
            orderBy('timestamp'),
            limit(50)
          );
          const allWordsSnapshot = await getDocs(allWordsQuery);
          const newWordsData = allWordsSnapshot.docs
            .filter(doc => !(nextReviewField in doc.data()))
            .map(doc => {
              const data = doc.data();
              return {
                id: doc.id,
                simplified: data.simplified,
                mandarin: data.mandarin,
                cantonese: data.cantonese,
                timestamp: data.timestamp,
                language: data.language,
                ...data
              } as VocabEntry;
            });
          setNewWords(newWordsData);
        } catch (error) {
          console.error('Error fetching word lists:', error);
          setMessage('Error fetching word lists');
        } finally {
          setIsLoading(false);
        }
      };

      fetchWordLists();
    }
  }, [showWordList, language, user]);

  // Handle authentication
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = onAuthChange((user) => {
      setUser(user);
      if (!user) {
        signIn().catch(error => {
          console.error("Sign in error:", error);
          setMessage(error.message || "Authentication failed. Please refresh and try again.");
        });
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Generate question when vocab changes
  useEffect(() => {
    let mounted = true;

    async function getQuestion() {
      if (currentVocab) {
        // Clear current question while generating new one
        setCurrentQuestion(null);
        try {
          console.log('Generating question for:', currentVocab.simplified, 'in', language);
          const response = await generateQuestion(currentVocab.simplified, language);
          // Only set the question if the component is still mounted
          if (mounted) {
            setCurrentQuestion({
              ...response,
              word: currentVocab.simplified,
              language
            });
            // Automatically play the audio when it's loaded
            playAudio(response.audio).catch(console.error);
          } else {
            console.log('Component unmounted, discarding generated question');
          }
        } catch (error) {
          console.error('Error generating question:', error);
          if (mounted) {
            setMessage('Error generating question');
          }
        }
      }
    }

    getQuestion();

    // Cleanup function to prevent setting state after unmount
    return () => {
      mounted = false;
    };
  }, [currentVocab?.id, language]); // Use vocab ID to track changes

  // Fetch next vocabulary word based on review time
  const fetchNextVocab = async () => {
    if (!user) {
      setMessage("Please sign in to continue");
      return;
    }

    setIsLoading(true);
    setEvaluation(null);
    setNextReview(null);
    setCurrentQuestion(null);
    const vocabRef = collection(db, 'vocabulary');
    const now = Timestamp.now();
    const nextReviewField = `nextReview${language.charAt(0).toUpperCase() + language.slice(1)}`;
    
    try {
      console.log('Fetching vocabulary...');
      console.log('Current language:', language);
      console.log('Review field:', nextReviewField);

      // First try to get a word that's due for review
        const dueQuery = query(
          vocabRef,
          where(nextReviewField, '<=', now),
          orderBy(nextReviewField), // Oldest due words first
          limit(1)
        );
        let snapshot = await getDocs(dueQuery);
        console.log('Due words query result:', !snapshot.empty);

        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          console.log('Found due word:', data);
          setCurrentVocab({
            id: doc.id,
            simplified: data.simplified,
            mandarin: data.mandarin,
            cantonese: data.cantonese,
            timestamp: data.timestamp,
            language: data.language,
            ...data
          } as VocabEntry);
          setMessage('');
          setIsLoading(false);
          return;
        }

        // If no words are due, try to get any word that hasn't been reviewed in this language
        const newQuery = query(
          vocabRef,
          orderBy('timestamp'), // Oldest first
          limit(50) // Get a larger batch since we need to filter
        );
        snapshot = await getDocs(newQuery);
        console.log('Fetched words:', snapshot.size);
        
        // Find words that don't have the review field for this language
        const newWords = snapshot.docs.filter(doc => {
          const data = doc.data();
          return !(nextReviewField in data);
        });
        console.log('New words for', language, ':', newWords.length);

        if (newWords.length > 0) {
          const newWord = newWords[0];
          const data = newWord.data();
          console.log('Selected new word:', data);
          setCurrentVocab({
            id: newWord.id,
            simplified: data.simplified,
            mandarin: data.mandarin,
            cantonese: data.cantonese,
            timestamp: data.timestamp,
            language: data.language,
            ...data
          } as VocabEntry);
          setMessage('');
          setIsLoading(false);
          return;
        }

        // If no new words and no due words, check when the next review is due
        const nextQuery = query(
          vocabRef,
          where(nextReviewField, '>', now),
          orderBy(nextReviewField), // Get the soonest due word
          limit(1)
        );
        const nextSnapshot = await getDocs(nextQuery);
        console.log('Next review query result:', !nextSnapshot.empty);
        
        if (!nextSnapshot.empty) {
          const doc = nextSnapshot.docs[0];
          const data = doc.data();
          console.log('Found next scheduled word:', data);
          const nextReviewTime = data[nextReviewField] as Timestamp;
          const minutesUntilNext = Math.ceil((nextReviewTime.toMillis() - now.toMillis()) / (1000 * 60));
          setMessage(`Next review available in ${minutesUntilNext} minutes`);
        } else {
          setMessage('No vocabulary available');
        }
        setCurrentVocab(null);
    } catch (error) {
      console.error('Error fetching vocabulary:', error);
      setMessage('Error fetching vocabulary');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user && language) {
      console.log('Fetching vocab for language:', language, 'user:', user.uid);
      // Reset states when language changes
      setCurrentVocab(null);
      setCurrentQuestion(null);
      setUserInput('');
      setHadDifficulty(false);
      setEvaluation(null);
      setNextReview(null);
      // Fetch new vocab
      fetchNextVocab();
    }
  }, [language, user?.uid]); // Proper dependency array

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVocab || !user) return;

    setIsLoading(true);
    try {
      if (!currentQuestion) {
        throw new Error('No question generated yet');
      }
      
      const result = await evaluateAnswer(
        currentVocab.id,
        language,
        userInput,
        hadDifficulty,
        currentQuestion.question
      );
      
      setEvaluation(result.evaluation);
      setNextReview(result.nextReview);
      setMessage(result.evaluation.feedback);

    } catch (error) {
      console.error('Error submitting answer:', error);
      setMessage('Error submitting answer');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateTime = async (newTime: string) => {
    if (!currentVocab) return;
    
    setIsLoading(true);
    try {
      await updateReviewTime(currentVocab.id, language, newTime);
      setNextReview(newTime);
      setMessage('Review time updated successfully');
    } catch (error) {
      console.error('Error updating review time:', error);
      setMessage('Error updating review time');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg">
          <div className="flex items-center justify-center">
            <LoadingSpinner />
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg">
          <p className="text-gray-600 mb-4">Please sign in with wzhybrid@gmail.com</p>
          <button 
            onClick={() => signIn()}
            className="bg-blue-500 text-white px-6 py-3 rounded-lg shadow hover:bg-blue-600 transition-colors"
          >
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* Language Selection */}
      <div className="mb-8 flex justify-center gap-4">
        <button
          onClick={() => setLanguage('mandarin')}
          className={`px-6 py-3 rounded-lg shadow transition-colors ${
            language === 'mandarin' 
              ? 'bg-blue-500 text-white' 
              : 'bg-white hover:bg-gray-50'
          }`}
          disabled={isLoading}
        >
          Mandarin
        </button>
        <button
          onClick={() => setLanguage('cantonese')}
          className={`px-6 py-3 rounded-lg shadow transition-colors ${
            language === 'cantonese' 
              ? 'bg-blue-500 text-white' 
              : 'bg-white hover:bg-gray-50'
          }`}
          disabled={isLoading}
        >
          Cantonese
        </button>
      </div>

      {/* Message Display */}
      {message && !evaluation && (
        <div className="max-w-lg mx-auto mb-4 p-3 text-center rounded-lg shadow-sm bg-white text-gray-700">
          {message}
        </div>
      )}

      {/* Loading Indicator */}
      {isLoading && (
        <div className="max-w-lg mx-auto mb-4 p-3 text-center text-gray-500">
          <LoadingSpinner />
          Loading...
        </div>
      )}

      {/* Chat Interface */}
      <div className="max-w-lg mx-auto bg-white rounded-lg shadow-lg p-6">
        {currentVocab && (
          <div className="mb-6">
            <div className="text-2xl font-bold text-blue-600 mb-3 chinese-text">
              {currentVocab.simplified}
            </div>
            <div className="flex items-start gap-2">
              {currentQuestion ? (
                <>
                  <div className="text-lg mb-4 chinese-text flex-grow">
                    {currentQuestion.question}
                  </div>
                  <button
                    onClick={() => currentQuestion.audio && playAudio(currentQuestion.audio)}
                    className="p-2 text-blue-500 hover:text-blue-600 transition-colors"
                    title="Play audio"
                  >
                    <SpeakerWaveIcon className="h-6 w-6" />
                  </button>
                </>
              ) : (
                <div className="text-lg mb-4 chinese-text flex-grow text-gray-500 flex items-center">
                  <LoadingSpinner />
                  Generating question...
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            className={`border p-3 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 chinese-text ${
              evaluation?.fluent === false ? 'border-yellow-300' :
              evaluation?.fluent === true ? 'border-green-300' :
              'border-gray-300'
            }`}
            placeholder="Type your response..."
            disabled={!currentVocab || isLoading}
          />
          <div className="flex gap-3">
            <button
              type="submit"
              className="bg-blue-500 text-white px-6 py-3 rounded-lg shadow hover:bg-blue-600 transition-colors flex-grow disabled:opacity-50"
              disabled={!currentVocab || isLoading}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => setHadDifficulty(!hadDifficulty)}
              className={`px-6 py-3 rounded-lg shadow transition-colors ${
                hadDifficulty 
                  ? 'bg-red-500 text-white hover:bg-red-600' 
                  : 'bg-yellow-500 text-white hover:bg-yellow-600'
              } disabled:opacity-50`}
              disabled={!currentVocab || isLoading}
            >
              {hadDifficulty ? 'Marked Difficult' : 'Had Difficulty'}
            </button>
          </div>
        </form>

        {evaluation && nextReview && (
          <>
            <EvaluationResult
              evaluation={evaluation}
              nextReview={nextReview}
              onUpdateTime={handleUpdateTime}
            />
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  setUserInput('');
                  setHadDifficulty(false);
                  setEvaluation(null);
                  setNextReview(null);
                  fetchNextVocab();
                }}
                className="bg-green-500 text-white px-6 py-3 rounded-lg shadow hover:bg-green-600 transition-colors"
              >
                Next Word
              </button>
            </div>
          </>
        )}
      </div>

      {/* Word List Button */}
      <div className="max-w-lg mx-auto mt-8">
        <button
          onClick={() => setShowWordList(!showWordList)}
          className="w-full bg-gray-100 text-gray-700 px-6 py-3 rounded-lg shadow hover:bg-gray-200 transition-colors"
        >
          Word List
        </button>
      </div>

      {/* Word List Modal */}
      {showWordList && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Word List ({language})</h2>
              <button
                onClick={() => setShowWordList(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              {/* Scheduled Words */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Scheduled Words</h3>
                <div className="space-y-2">
                  {scheduledWords.map((word) => {
                    const reviewField = `nextReview${language.charAt(0).toUpperCase() + language.slice(1)}`;
                    const reviewTimestamp = word[reviewField];
                    const reviewTime = reviewTimestamp?.toDate();
                    const isOverdue = reviewTime && reviewTime < new Date();
                    
                    return (
                      <div 
                        key={word.id} 
                        className={`flex justify-between items-center p-3 rounded ${
                          isOverdue ? 'bg-red-50' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="chinese-text text-lg">{word.simplified}</span>
                          {isOverdue && (
                            <span className="text-red-500 text-sm font-medium">Overdue</span>
                          )}
                        </div>
                        <span className={`${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                          {reviewTime ? reviewTime.toLocaleString() : 'No review time set'}
                        </span>
                      </div>
                    );
                  })}
                  {scheduledWords.length === 0 && (
                    <p className="text-gray-500">No scheduled words</p>
                  )}
                </div>
              </div>

              {/* New Words */}
              <div>
                <h3 className="text-lg font-semibold mb-3">New Words</h3>
                <div className="space-y-2">
                  {newWords.map((word) => (
                    <div key={word.id} className="flex items-center p-3 bg-gray-50 rounded">
                      <span className="chinese-text text-lg">{word.simplified}</span>
                    </div>
                  ))}
                  {newWords.length === 0 && (
                    <p className="text-gray-500">No new words</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;