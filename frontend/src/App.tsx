import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs, Timestamp, where } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './services/firebase';
import { signIn, onAuthChange } from './services/auth';
import { evaluateAnswer, updateReviewTime, markWordMastered, type AnswerEvaluation } from './services/scheduler';
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
  onTimeChange 
}: { 
  evaluation: AnswerEvaluation; 
  nextReview: { toDate: () => Date };
  onTimeChange: (newTime: { toDate: () => Date }) => void;
}) {
  const [selectedTime, setSelectedTime] = useState(nextReview);

  // Initialize selectedTime from nextReview
  useEffect(() => {
    setSelectedTime(nextReview);
  }, [nextReview]);

  // Format datetime-local input value from selectedTime
  const date = selectedTime.toDate();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const inputValue = `${year}-${month}-${day}T${hours}:${minutes}`;
  console.log('Input value:', inputValue);

  // Handle time change
  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('3. New input value:', e.target.value);
    const date = new Date(e.target.value);
    console.log('4. Date from input:', date.toString());
    
    // Convert to Timestamp (preserving exact time user selected)
    const timestamp = Timestamp.fromDate(date);
    console.log('5. New Timestamp:', timestamp);
    setSelectedTime(timestamp);
    onTimeChange(timestamp);
  };

  // Format display time from nextReview (not selectedTime)
  const displayTime = nextReview.toDate().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  console.log('Display time:', displayTime);

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
      
      <div>
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
  const [nextReview, setNextReview] = useState<{ toDate: () => Date } | null>(null);
  const [selectedReviewTime, setSelectedReviewTime] = useState<{ toDate: () => Date } | null>(null);
  const [showWordList, setShowWordList] = useState(false);
  const [scheduledWords, setScheduledWords] = useState<VocabEntry[]>([]);
  const [newWords, setNewWords] = useState<VocabEntry[]>([]);
  const [masteredWords, setMasteredWords] = useState<VocabEntry[]>([]);
  const [expandedSections, setExpandedSections] = useState<{
    scheduled: boolean;
    new: boolean;
    mastered: boolean;
  }>({
    scheduled: false,
    new: false,
    mastered: false,
  });

  // Fetch word lists when language changes or modal opens
  useEffect(() => {
    if (showWordList && user) {
      fetchWordLists();
    }
  }, [showWordList, language, user]);

  // Function to fetch word lists
  const fetchWordLists = async () => {
    if (!user) return;
    
    setIsLoading(true);
    const vocabRef = collection(db, 'vocabulary');
    const nextReviewField = `nextReview${language.charAt(0).toUpperCase() + language.slice(1)}`;
    
    try {
      const masteredField = `mastered_${language}`;

      // Fetch all words with review times
      const scheduledQuery = query(
        vocabRef,
        orderBy(nextReviewField),
        limit(50)
      );
      const scheduledSnapshot = await getDocs(scheduledQuery);
      const scheduledWordsData = scheduledSnapshot.docs
        .filter(doc => {
          const data = doc.data();
          // Include only words that have a review time and aren't mastered
          return nextReviewField in data && data[masteredField] !== true;
        })
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
      setScheduledWords(scheduledWordsData);

      // Fetch mastered words
      const masteredQuery = query(
        vocabRef,
        where(masteredField, '==', true),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      const masteredSnapshot = await getDocs(masteredQuery);
      const masteredWordsData = masteredSnapshot.docs
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
      setMasteredWords(masteredWordsData);

      // Fetch all words ordered by timestamp
      const newWordsQuery = query(
        vocabRef,
        orderBy('timestamp'),
        limit(50)
      );
      const newWordsSnapshot = await getDocs(newWordsQuery);
      const newWordsData = newWordsSnapshot.docs
        .filter(doc => {
          const data = doc.data();
          // Include only words that don't have a review time and aren't mastered
          return !(nextReviewField in data) && data[masteredField] !== true;
        })
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
          // Pass the cantonese entry from Firestore for alternative word detection
          const cantoneseEntry = language === 'cantonese' ? currentVocab.cantonese : undefined;
          console.log('Cantonese entry from Firestore:', cantoneseEntry);
          const response = await generateQuestion(currentVocab.simplified, language, cantoneseEntry);
          console.log('Question response:', response);
          // Only set the question if the component is still mounted
          if (mounted) {
            setCurrentQuestion({
              ...response,
              word: currentVocab.simplified,
              language,
              requires_alternative: response.requires_alternative || false,
              target_word: response.target_word || currentVocab.simplified
            });
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
      const masteredField = `mastered_${language}`;
      
      console.log('Fetching vocabulary...');
      console.log('Current language:', language);
      console.log('Review field:', nextReviewField);
      console.log('Mastered field:', masteredField);
      console.log('Current time:', now.toDate().toLocaleString());

      // First try to get a word that's due for review
      const dueQuery = query(
        vocabRef,
        where(nextReviewField, '<=', now),
        limit(50)
      );
      let snapshot = await getDocs(dueQuery);
      console.log('Due words query result:', !snapshot.empty);

      // Filter out mastered words
      const dueWords = snapshot.docs.filter(doc => {
        const data = doc.data();
        return data[masteredField] !== true;
      });

      if (dueWords.length > 0) {
        const doc = dueWords[0];
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
        orderBy('timestamp'),
        limit(50)
      );
      snapshot = await getDocs(newQuery);
      console.log('Fetched words:', snapshot.size);
      
      // Find words that don't have a review time and aren't mastered
      const newWords = snapshot.docs.filter(doc => {
        const data = doc.data();
        return !(nextReviewField in data) && data[masteredField] !== true;
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
          orderBy(nextReviewField),
          limit(1)
        );
        const nextSnapshot = await getDocs(nextQuery);
        console.log('Next review query result:', !nextSnapshot.empty);
        
        // Filter out mastered words
        const nextWords = nextSnapshot.docs.filter(doc => {
          const data = doc.data();
          return data[masteredField] !== true;
        });
        
        if (nextWords.length > 0) {
          const doc = nextWords[0];
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
        currentQuestion.question,
        currentQuestion.requires_alternative,  // Pass from generate_vocab_question
        currentQuestion.target_word  // Pass the actual word used in the question
      );
      
      // Convert raw timestamp data to Firestore Timestamp
      const timestamp = new Timestamp(result.nextReview.seconds, result.nextReview.nanoseconds);
      console.log('Raw timestamp data:', result.nextReview);
      console.log('Converted to Firestore Timestamp:', timestamp);
      console.log('Local time:', timestamp.toDate().toLocaleString());
      
      setEvaluation(result.evaluation);
      setNextReview(timestamp);
      setMessage(result.evaluation.feedback);

    } catch (error) {
      console.error('Error submitting answer:', error);
      setMessage('Error submitting answer');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateTime = async (newTime: { toDate: () => Date }) => {
    if (!currentVocab) return;
    
    setIsLoading(true);
    try {
      // Convert to ISO string without milliseconds
      const date = newTime.toDate();
      const isoString = date.toISOString().split('.')[0];
      console.log('Update time - ISO string to backend:', isoString);
      const result = await updateReviewTime(currentVocab.id, language, isoString);
      
      // Convert raw timestamp data to Firestore Timestamp
      const timestamp = new Timestamp(result.nextReview.seconds, result.nextReview.nanoseconds);
      console.log('Update time - Raw timestamp data:', result.nextReview);
      console.log('Update time - Converted to Firestore Timestamp:', timestamp);
      console.log('Update time - Local time:', timestamp.toDate().toLocaleString());
      
      setNextReview(timestamp);
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
            <button
              type="button"
              onClick={async () => {
                if (!currentVocab) return;
                setIsLoading(true);
                try {
                  await markWordMastered(currentVocab.id, language);
                  setMessage('Word marked as mastered');
                  // Reset states
                  setUserInput('');
                  setHadDifficulty(false);
                  setEvaluation(null);
                  setNextReview(null);
                  setSelectedReviewTime(null);
                  setCurrentVocab(null);
                  setCurrentQuestion(null);
                  // Fetch next word
                  await fetchNextVocab();
                } catch (error) {
                  console.error('Error marking word as mastered:', error);
                  setMessage('Error marking word as mastered');
                } finally {
                  setIsLoading(false);
                }
              }}
              className="bg-green-600 text-white px-4 py-3 rounded-lg shadow hover:bg-green-700 transition-colors disabled:opacity-50"
              disabled={!currentVocab || isLoading}
            >
              Mastered
            </button>
          </div>
        </form>

        {evaluation && nextReview && (
          <>
            <EvaluationResult
              evaluation={evaluation}
              nextReview={nextReview}
              onTimeChange={setSelectedReviewTime}
            />
            <div className="mt-4 flex justify-end">
              <button
                onClick={async () => {
                  // If review time was changed, update it first
                  if (selectedReviewTime && selectedReviewTime !== nextReview) {
                    await handleUpdateTime(selectedReviewTime);
                  }
                  setUserInput('');
                  setHadDifficulty(false);
                  setEvaluation(null);
                  setNextReview(null);
                  setSelectedReviewTime(null);
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Word List ({language})</h2>
              <button
                onClick={() => setShowWordList(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Scheduled Words */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold mb-3">Scheduled Words</h3>
                <div className="space-y-2">
                  {scheduledWords.slice(0, expandedSections.scheduled ? undefined : 5).map((word) => {
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
                        <div className="flex items-center gap-2">
                          <span className={`${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                            {reviewTime ? reviewTime.toLocaleString() : 'No review time set'}
                          </span>
                          {!reviewTime && (
                            <button
                              onClick={async () => {
                                setIsLoading(true);
                                try {
                                  // Set an initial review time for 5 minutes from now
                                  const date = new Date();
                                  date.setMinutes(date.getMinutes() + 5);
                                  const isoString = date.toISOString().split('.')[0];
                                  await updateReviewTime(word.id, language, isoString);
                                  // Refresh word lists
                                  await fetchWordLists();
                                } catch (error) {
                                  console.error('Error setting review time:', error);
                                  setMessage('Error setting review time');
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                              className="text-blue-500 hover:text-blue-600 p-2"
                              title="Set review time"
                            >
                              Schedule
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {scheduledWords.length === 0 ? (
                    <p className="text-gray-500">No scheduled words</p>
                  ) : scheduledWords.length > 5 && (
                    <button
                      onClick={() => setExpandedSections(prev => ({
                        ...prev,
                        scheduled: !prev.scheduled
                      }))}
                      className="w-full mt-2 text-blue-500 hover:text-blue-600 text-sm font-medium"
                    >
                      {expandedSections.scheduled ? 'Show Less' : `See ${scheduledWords.length - 5} More`}
                    </button>
                  )}
                </div>
              </div>

              {/* New Words */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold mb-3">New Words</h3>
                <div className="space-y-2">
                  {newWords.slice(0, expandedSections.new ? undefined : 5).map((word) => (
                    <div key={word.id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                      <span className="chinese-text text-lg">{word.simplified}</span>
                      <button
                        onClick={async () => {
                          setIsLoading(true);
                          try {
                            // Set an initial review time for 5 minutes from now
                            const date = new Date();
                            date.setMinutes(date.getMinutes() + 5);
                            const isoString = date.toISOString().split('.')[0];
                            await updateReviewTime(word.id, language, isoString);
                            // Refresh word lists
                            await fetchWordLists();
                          } catch (error) {
                            console.error('Error setting review time:', error);
                            setMessage('Error setting review time');
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        className="text-blue-500 hover:text-blue-600 p-2"
                        title="Set review time"
                      >
                        Schedule
                      </button>
                    </div>
                  ))}
                  {newWords.length === 0 ? (
                    <p className="text-gray-500">No new words</p>
                  ) : newWords.length > 5 && (
                    <button
                      onClick={() => setExpandedSections(prev => ({
                        ...prev,
                        new: !prev.new
                      }))}
                      className="w-full mt-2 text-blue-500 hover:text-blue-600 text-sm font-medium"
                    >
                      {expandedSections.new ? 'Show Less' : `See ${newWords.length - 5} More`}
                    </button>
                  )}
                </div>
              </div>

              {/* Mastered Words */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold mb-3">Mastered Words</h3>
                <div className="space-y-2">
                  {masteredWords.slice(0, expandedSections.mastered ? undefined : 5).map((word) => (
                    <div key={word.id} className="flex justify-between items-center p-3 bg-green-50 rounded">
                      <span className="chinese-text text-lg">{word.simplified}</span>
                      <button
                        onClick={async () => {
                          setIsLoading(true);
                          try {
                            await markWordMastered(word.id, language, false);
                            // Set an initial review time for 5 minutes from now
                            const date = new Date();
                            date.setMinutes(date.getMinutes() + 5);
                            const isoString = date.toISOString().split('.')[0];
                            await updateReviewTime(word.id, language, isoString);
                            // Refresh word lists
                            await fetchWordLists();
                          } catch (error) {
                            console.error('Error unmarking word:', error);
                            setMessage('Error unmarking word');
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        className="text-red-500 hover:text-red-600 p-2"
                        title="Unmark as mastered"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {masteredWords.length === 0 ? (
                    <p className="text-gray-500">No mastered words</p>
                  ) : masteredWords.length > 5 && (
                    <button
                      onClick={() => setExpandedSections(prev => ({
                        ...prev,
                        mastered: !prev.mastered
                      }))}
                      className="w-full mt-2 text-blue-500 hover:text-blue-600 text-sm font-medium"
                    >
                      {expandedSections.mastered ? 'Show Less' : `See ${masteredWords.length - 5} More`}
                    </button>
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
