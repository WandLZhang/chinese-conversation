"""
@file main.py
@brief Cloud Function for generating audio using Gemini Live API.

@details This function uses the Gemini Live API to generate spoken audio
for Chinese sentences (Mandarin or Cantonese). It establishes a WebSocket
connection to the Live API, sends a text prompt requesting the sentence
be spoken in the target language, captures the audio response, and returns
it as base64-encoded data.

"""

import functions_framework
from flask import jsonify
import asyncio
import base64
import os
import logging
import io
import wave
import random

from google import genai

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Audio configuration for Gemini Live API
FORMAT_BYTES = 2  # 16-bit audio = 2 bytes per sample
CHANNELS = 1
RECEIVE_SAMPLE_RATE = 24000

# Model for Gemini Live API - from official cookbook
MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

# Available voice styles for Gemini Live API
# See: https://ai.google.dev/gemini-api/docs/live#voices
VOICE_STYLES = ["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"]


def get_api_key():
    """Get Gemini API key from environment variable or tmp secrets file."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if api_key:
        os.environ['GOOGLE_API_KEY'] = api_key
        return api_key
    
    api_key = os.environ.get("GOOGLE_API_KEY")
    if api_key:
        return api_key
    
    # Try loading from tmp/secrets.env for local testing
    secrets_path = os.path.join(os.path.dirname(__file__), '..', '..', 'tmp', 'secrets.env')
    if os.path.exists(secrets_path):
        with open(secrets_path, 'r') as f:
            for line in f:
                if line.startswith('GEMINI_API_KEY='):
                    api_key = line.split('=', 1)[1].strip()
                    os.environ['GOOGLE_API_KEY'] = api_key
                    return api_key
    
    raise ValueError("GEMINI_API_KEY/GOOGLE_API_KEY not found in environment or tmp/secrets.env")


def pcm_to_wav(pcm_data: bytes, sample_rate: int = RECEIVE_SAMPLE_RATE, channels: int = CHANNELS) -> bytes:
    """
    @brief Convert raw PCM audio data to WAV format.
    
    @param pcm_data Raw PCM audio bytes (16-bit signed, little-endian)
    @param sample_rate Sample rate in Hz
    @param channels Number of audio channels
    
    @return WAV-formatted audio bytes
    """
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(FORMAT_BYTES)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    wav_buffer.seek(0)
    return wav_buffer.read()


async def generate_audio_with_live_api(sentence: str, language: str) -> bytes:
    """
    @brief Generate audio for a sentence using Gemini Live API.
    
    @details Establishes a WebSocket connection to Gemini Live API,
    sends a prompt requesting the sentence be spoken in the target language,
    and collects all audio chunks from the response.
    
    @param sentence The Chinese sentence to be spoken
    @param language Either 'mandarin' or 'cantonese'
    
    @return Raw PCM audio bytes from Gemini Live API
    """
    # Ensure API key is set
    get_api_key()
    
    # Create client (uses GOOGLE_API_KEY env var)
    client = genai.Client(http_options={"api_version": "v1beta"})
    
    # Randomly select a voice style
    voice = random.choice(VOICE_STYLES)
    
    # Build config with random voice
    config = {
        "response_modalities": ["AUDIO"],
        "speech_config": {
            "voice_config": {
                "prebuilt_voice_config": {
                    "voice_name": voice
                }
            }
        }
    }
    
    # Build the prompt based on language
    language_name = "Mandarin Chinese" if language == "mandarin" else "Cantonese"
    prompt = f"Please say this sentence in {language_name}, speaking clearly and naturally: {sentence}"
    
    logger.info(f"Generating audio for: {sentence}")
    logger.info(f"Language: {language_name}")
    logger.info(f"Voice: {voice}")
    logger.info(f"Prompt: {prompt}")
    
    audio_chunks = []
    
    async with client.aio.live.connect(model=MODEL, config=config) as session:
        # Send the text prompt
        await session.send(input=prompt, end_of_turn=True)
        
        # Collect audio response
        turn = session.receive()
        async for response in turn:
            if data := response.data:
                audio_chunks.append(data)
                logger.info(f"Received audio chunk: {len(data)} bytes")
    
    # Combine all audio chunks
    combined_audio = b''.join(audio_chunks)
    logger.info(f"Total audio collected: {len(combined_audio)} bytes")
    
    return combined_audio


def run_async(coro):
    """Run an async coroutine in a new event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@functions_framework.http
def generate_audio_live(request):
    """
    @brief HTTP Cloud Function for generating audio using Gemini Live API.
    
    @details Accepts POST requests with JSON body containing:
    - sentence: The Chinese sentence to be spoken
    - language: Either 'mandarin' or 'cantonese'
    
    Returns JSON with:
    - audio: Base64-encoded WAV audio data
    
    @param request Flask request object
    @return Tuple of (response, status_code, headers)
    """
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
        
        logger.info(f"\n====== Audio Generation Request ======")
        logger.info(f"Request JSON: {request_json}")
        
        if not request_json or 'sentence' not in request_json or 'language' not in request_json:
            return (jsonify({'error': 'sentence and language are required'}), 400, headers)

        sentence = request_json['sentence']
        language = request_json['language']
        
        if language not in ['mandarin', 'cantonese']:
            return (jsonify({'error': 'language must be mandarin or cantonese'}), 400, headers)
        
        logger.info(f"Sentence: {sentence}")
        logger.info(f"Language: {language}")
        
        # Generate audio using Gemini Live API
        pcm_audio = run_async(generate_audio_with_live_api(sentence, language))
        
        if not pcm_audio:
            return (jsonify({'error': 'Failed to generate audio - no audio data received'}), 500, headers)
        
        # Convert PCM to WAV format for browser playback
        wav_audio = pcm_to_wav(pcm_audio)
        
        # Return as base64
        audio_base64 = base64.b64encode(wav_audio).decode('utf-8')
        
        response_data = {
            'audio': audio_base64
        }
        
        logger.info(f"Successfully generated audio: {len(wav_audio)} bytes WAV")
        
        return (jsonify(response_data), 200, headers)
        
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return (jsonify({'error': str(e)}), 500, headers)
