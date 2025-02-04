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

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Vertex AI
PROJECT_ID = "wz-data-catalog-demo"
LOCATION = "us-central1"

# Initialize AnthropicVertex client
client = AnthropicVertex(
    region="us-east5",
    project_id=PROJECT_ID
)

# Initialize Text-to-Speech client
tts_client = texttospeech.TextToSpeechClient()

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

def generate_cantonese_question(vocabulary_word):
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
    
    system_instruction = f"""You are a natural Cantonese language generator specializing in authentic Hong Kong Cantonese usage. Your task is to generate engaging questions that demonstrate the usage of vocabulary words in natural contexts.

    Entry Type: {"Exact match" if is_exact_match else "No exact match"}
    Entry Formality: {"Formal/Written" if is_formal else "Colloquial"}

    Process for Question Generation:
    1. For formal/written entries (marked as 書面語, 大陸, or !!!formal):
    - DO NOT use the formal word in your question
    - Instead use these colloquial alternatives: {', '.join(alternatives) if alternatives else 'common spoken Cantonese expressions'}
    - Create a question using natural spoken Cantonese that expresses the same meaning

    2. For colloquial entries:
    - Use the Words.HK entry as your guide
    - Ensure the question reflects typical Hong Kong speech patterns

    Guidelines:
    - Generate a question that naturally incorporates the vocabulary or its colloquial equivalent
    - Make the question contextual and engaging, as if in a real conversation
    - Focus on daily life situations where this word/concept would naturally come up
    - Avoid overly formal or textbook-style questions

    Retrieved Dictionary Entry:
    {retrieved_text}

    IMPORTANT: Output ONLY the Cantonese question with NO additional text - no jyutping, no translation, no explanation."""

    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-v2@20241022",
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
        return response.content[0].text.strip()
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
            model="claude-3-5-sonnet-v2@20241022",
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
        if not request_json or 'word' not in request_json or 'language' not in request_json:
            return (jsonify({'error': 'Word and language are required'}), 400, headers)

        vocabulary_word = request_json['word']
        language = request_json['language']
        
        # Initialize Vertex AI
        initialize_vertexai()
        
        # Generate question based on language
        if language == 'cantonese':
            question = generate_cantonese_question(vocabulary_word)
        else:
            question = generate_mandarin_question(vocabulary_word)
        
        if not question:
            return (jsonify({'error': 'Failed to generate question'}), 500, headers)
        
        # Generate audio for the question
        audio_content = get_audio_content(question, language)
        if not audio_content:
            return (jsonify({'error': 'Failed to generate audio'}), 500, headers)

        return (jsonify({
            'question': question,
            'audio': audio_content  # Base64 encoded audio content
        }), 200, headers)
        
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        return (jsonify({'error': str(e)}), 500, headers)
