import functions_framework
from flask import jsonify
from vertexai.preview import rag
from vertexai.preview.generative_models import GenerativeModel, SafetySetting
import vertexai
from anthropic import AnthropicVertex
from google.cloud import texttospeech
import base64
import logging
import re
import opencc

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Vertex AI
PROJECT_ID = "wz-data-catalog-demo"
LOCATION = "us-central1"

# Initialize AnthropicVertex client
client = AnthropicVertex(
    region="global",
    project_id=PROJECT_ID
)

# Initialize Text-to-Speech client
tts_client = texttospeech.TextToSpeechClient()

# Initialize Chinese converter (Simplified to Traditional)
converter = opencc.OpenCC('s2t')

def check_cantonese_usage(vocab_word: str, cantonese_entry: str) -> bool:
    """Check if the traditional form of the vocabulary word appears in the Cantonese entry.
    Returns True if word is found (use as-is), False if not found (need alternative)."""
    if not cantonese_entry:
        return True  # No entry to check against, use word as-is
    traditional_word = converter.convert(vocab_word)
    result = traditional_word in cantonese_entry
    logger.info(f"check_cantonese_usage: vocab_word={vocab_word}, traditional={traditional_word}, found_in_entry={result}")
    return result

def get_audio_content(text: str, language: str) -> str:
    """Generate audio content for the given text and return as base64."""
    # Configure voice based on language
    if language == 'cantonese':
        voice = texttospeech.VoiceSelectionParams(
            language_code="yue-HK",
            name="yue-HK-Standard-B"
        )
    else:
        voice = texttospeech.VoiceSelectionParams(
            language_code="cmn-CN",
            name="cmn-CN-Wavenet-A"  # Using Wavenet voice for better quality
        )

    # Configure audio
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.LINEAR16,
        effects_profile_id=["small-bluetooth-speaker-class-device"],
        speaking_rate=1.0,
        pitch=0 if language == 'mandarin' else -1.2  # Default pitch for Mandarin, slightly lower for Cantonese
    )

    # Build synthesis input
    synthesis_input = texttospeech.SynthesisInput(text=text)

    try:
        # Perform text-to-speech request
        response = tts_client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config
        )

        # Return base64 encoded audio content
        return base64.b64encode(response.audio_content).decode('utf-8')
    except Exception as e:
        logger.error(f"Error generating audio: {e}")
        return None

def initialize_vertexai():
    try:
        vertexai.init(project=PROJECT_ID, location=LOCATION)
        logger.info("Vertex AI initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Vertex AI: {e}")
        raise

def get_rag_corpus():
    try:
        corpora = rag.list_corpora()
        corpus_list = list(corpora)
        
        if not corpus_list:
            logger.error("No RAG corpora found in the project")
            return None
        
        return corpus_list[0].name
    except Exception as e:
        logger.error(f"Error retrieving RAG corpus: {e}")
        return None

def perform_rag_retrieval(corpus_name, vocabulary_word):
    try:
        response = rag.retrieval_query(
            rag_resources=[
                rag.RagResource(
                    rag_corpus=corpus_name,
                )
            ],
            text=vocabulary_word,
            similarity_top_k=3,
            vector_distance_threshold=0.5,
        )
        return response
    except Exception as e:
        logger.error(f"Error performing RAG retrieval: {e}")
        return None

def find_best_entry(contexts, vocabulary_word: str):
    """Find the best matching entry from all retrieved contexts."""
    if not contexts:
        return "", False, False, []
        
    # First try to find an exact match
    for context in contexts:
        text = context.text.strip()
        match = re.match(r'^\d+,([^:]+):', text)
        if match and match.group(1) == vocabulary_word:
            is_formal = any(marker in text for marker in [
                "(label:書面語)",
                "(label:大陸)",
                "!!!formal"
            ])
            alternatives = []
            sim_matches = re.findall(r'\(sim:([^)]+)\)', text)
            alternatives.extend(sim_matches)
            return text, True, is_formal, alternatives
            
    # If no exact match found, return first context
    text = contexts[0].text.strip()
    is_formal = any(marker in text for marker in [
        "(label:書面語)",
        "(label:大陸)",
        "!!!formal"
    ])
    alternatives = []
    sim_matches = re.findall(r'\(sim:([^)]+)\)', text)
    alternatives.extend(sim_matches)
    return text, False, is_formal, alternatives

def extract_target_word_from_question(question: str, vocab_word: str) -> str:
    """Use Claude to extract the actual word used in the generated question that corresponds to the vocab meaning."""
    try:
        system_prompt = """You are a Cantonese language expert. Given a vocabulary word and a generated question,
        identify the Cantonese word or expression used in the question that corresponds to the meaning of the vocabulary word.
        Return ONLY the identified Cantonese characters, nothing else."""
        
        response = client.messages.create(
            model="claude-sonnet-4-5@20250929",
            max_tokens=100,
            temperature=0,
            messages=[{
                "role": "user",
                "content": f"""Vocabulary word: {vocab_word}
                Generated question: {question}
                
                What Cantonese word/expression in this question corresponds to the meaning of '{vocab_word}'?
                Return ONLY the Cantonese characters."""
            }],
            system=system_prompt
        )
        
        target_word = response.content[0].text.strip()
        logger.info(f"Extracted target word from question: {target_word}")
        return target_word
    except Exception as e:
        logger.error(f"Error extracting target word: {str(e)}")
        return vocab_word  # Fallback to original word if extraction fails

def generate_cantonese_question(vocabulary_word: str, requires_alternative: bool, cantonese_entry: str = None):
    """Generate a Cantonese question, using colloquial expression if requires_alternative is True."""
    
    logger.info(f"\n=== generate_cantonese_question ===")
    logger.info(f"vocabulary_word: {vocabulary_word}")
    logger.info(f"requires_alternative: {requires_alternative}")
    logger.info(f"cantonese_entry: {cantonese_entry}")
    
    # Get RAG corpus for additional context
    corpus_name = get_rag_corpus()
    retrieved_entry = perform_rag_retrieval(corpus_name, vocabulary_word)
    
    retrieved_text = ""
    is_exact_match = False
    is_formal = False
    alternatives = []
    
    if retrieved_entry and retrieved_entry.contexts.contexts:
        retrieved_text, is_exact_match, is_formal, alternatives = find_best_entry(
            retrieved_entry.contexts.contexts, 
            vocabulary_word
        )
        logger.info(f"\n=== RAG Retrieval Results ===")
        logger.info(f"Retrieved text: {retrieved_text}")
        logger.info(f"Is exact match: {is_exact_match}")
        logger.info(f"Is formal: {is_formal}")
        logger.info(f"Alternatives from RAG: {alternatives}")
    
    # Build the system instruction based on whether alternative is required
    if requires_alternative:
        # The vocab word is NOT used colloquially in Cantonese
        # We have the Firestore cantonese entry which shows how natives express this
        system_instruction = f"""You are a natural Cantonese language generator specializing in authentic Hong Kong Cantonese usage.

CRITICAL INSTRUCTION: The vocabulary word "{vocabulary_word}" is a FORMAL/WRITTEN word that Cantonese speakers do NOT use in daily conversation.

REFERENCE: Here is an example of how a native Cantonese speaker would express this concept:
{cantonese_entry if cantonese_entry else "Not available"}

Your task:
1. Generate a natural conversational Cantonese question
2. DO NOT use the formal word "{vocabulary_word}" 
3. Use the colloquial Cantonese expression that natives actually use
4. Look at the reference example to understand what word/expression Cantonese speakers use instead
5. Make it sound like something a Hong Kong person would actually say

RAG Dictionary Entry (for additional context):
{retrieved_text}

IMPORTANT: Output ONLY the Cantonese question with NO additional text - no jyutping, no translation, no explanation."""
    else:
        # The vocab word IS used in Cantonese, so use it directly
        system_instruction = f"""You are a natural Cantonese language generator specializing in authentic Hong Kong Cantonese usage.

The vocabulary word "{vocabulary_word}" IS commonly used in Cantonese conversation.

Your task:
1. Generate a natural conversational Cantonese question
2. USE the vocabulary word "{vocabulary_word}" in your question
3. Make it sound like something a Hong Kong person would actually say
4. Focus on daily life situations where this word would naturally come up

RAG Dictionary Entry (for context):
{retrieved_text}

IMPORTANT: Output ONLY the Cantonese question with NO additional text - no jyutping, no translation, no explanation."""

    logger.info(f"\n=== System Instruction to Claude ===")
    logger.info(system_instruction)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-5@20250929",
            max_tokens=100,
            temperature=0.7,
            messages=[
                {
                    "role": "user",
                    "content": f"Input: {vocabulary_word}\nGenerate ONLY a single natural Cantonese question."
                }
            ],
            system=system_instruction
        )
        question = response.content[0].text.strip()
        logger.info(f"\n=== Generated Question ===")
        logger.info(f"Question: {question}")
        return question
    except Exception as e:
        logger.error(f"Error generating Cantonese question with Claude: {e}")
        return None

def generate_mandarin_question(vocabulary_word):
    system_instruction = """You are a Mandarin language tutor specializing in creating engaging, contextual questions. Your task is to generate questions that naturally incorporate vocabulary words while avoiding textbook-style or overly simplistic constructions.

    Guidelines:
    1. Create questions that demonstrate the word's usage in meaningful contexts
    2. Focus on real-life situations where the word would naturally be used
    3. Make the questions engaging and conversational
    4. Ensure the vocabulary word is used naturally within the question
    5. Avoid basic "what is X" style questions
    6. Use the vocabulary word in a way that clearly shows its meaning

    IMPORTANT: Output ONLY the Mandarin question with NO additional text or explanation."""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-5@20250929",
            max_tokens=100,
            temperature=0.7,
            messages=[
                {
                    "role": "user",
                    "content": f"Input: {vocabulary_word}\nGenerate ONLY a single natural Mandarin question."
                }
            ],
            system=system_instruction
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.error(f"Error generating Mandarin question with Claude: {e}")
        return None

@functions_framework.http
def generate_vocab_question(request):
    # Set CORS headers for preflight requests
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for main requests
    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    try:
        request_json = request.get_json()
        
        logger.info(f"\n====== New Question Generation Request ======")
        logger.info(f"Request JSON: {request_json}")
        
        if not request_json or 'word' not in request_json or 'language' not in request_json:
            return (jsonify({'error': 'Word and language are required'}), 400, headers)

        vocabulary_word = request_json['word']
        language = request_json['language']
        cantonese_entry = request_json.get('cantoneseEntry', '')  # NEW: Get Firestore cantonese entry
        
        logger.info(f"vocabulary_word: {vocabulary_word}")
        logger.info(f"language: {language}")
        logger.info(f"cantonese_entry from Firestore: {cantonese_entry}")
        
        # Initialize Vertex AI
        initialize_vertexai()
        
        # Determine if alternative is required (for Cantonese only)
        requires_alternative = False
        target_word = vocabulary_word
        
        if language == 'cantonese':
            # Check if the vocab word appears in the Cantonese example sentence
            requires_alternative = not check_cantonese_usage(vocabulary_word, cantonese_entry)
            logger.info(f"requires_alternative: {requires_alternative}")
        
        # Generate question based on language
        if language == 'cantonese':
            question = generate_cantonese_question(vocabulary_word, requires_alternative, cantonese_entry)
        else:
            question = generate_mandarin_question(vocabulary_word)
        
        if not question:
            return (jsonify({'error': 'Failed to generate question'}), 500, headers)
        
        # For Cantonese with alternative required, extract the actual word used in the question
        if language == 'cantonese' and requires_alternative:
            target_word = extract_target_word_from_question(question, vocabulary_word)
            logger.info(f"Extracted target_word: {target_word}")
        
        # Generate audio for the question
        audio_content = get_audio_content(question, language)
        if not audio_content:
            return (jsonify({'error': 'Failed to generate audio'}), 500, headers)

        response_data = {
            'question': question,
            'audio': audio_content,
            'requires_alternative': requires_alternative,  # NEW: Tell frontend/evaluate if alternative was used
            'target_word': target_word  # NEW: The actual word used in the question
        }
        
        logger.info(f"\n=== Response ===")
        logger.info(f"question: {question}")
        logger.info(f"requires_alternative: {requires_alternative}")
        logger.info(f"target_word: {target_word}")
        
        return (jsonify(response_data), 200, headers)
        
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return (jsonify({'error': str(e)}), 500, headers)
