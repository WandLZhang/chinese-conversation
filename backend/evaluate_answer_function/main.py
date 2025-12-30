import functions_framework
from flask import jsonify, request
from google.cloud import firestore
from anthropic import AnthropicVertex
import os
from datetime import datetime, timedelta
import opencc
import json
from google.cloud.firestore_v1.types import document
from google.protobuf.timestamp_pb2 import Timestamp

def serialize_firestore(obj):
    """Custom JSON serializer for Firestore types"""
    if isinstance(obj, (document.DocumentSnapshot, dict)):
        return {k: serialize_firestore(v) for k, v in obj.items()}
    elif isinstance(obj, (Timestamp, datetime)):
        return obj.isoformat()
    elif isinstance(obj, list):
        return [serialize_firestore(item) for item in obj]
    return obj

# Initialize clients
db = firestore.Client()
client = AnthropicVertex(
    region="global",
    project_id=os.getenv('PROJECT_ID')
)

# Initialize Chinese converter
converter = opencc.OpenCC('s2t')  # Simplified to Traditional converter

# Scheduling intervals in minutes
INTERVALS = {
    "DIFFICULTY": {
        "IMMEDIATE": 5,      # For had_difficulty=True
        "SHORT": 15,        # For non-fluent usage
        "MEDIUM": 30        # For basic correct usage
    },
    "SUCCESS": {
        "INITIAL": [4320],    # 3d for first success
        "SUBSEQUENT": [21600, 86400]  # 15d, 60d for subsequent successes
    }
}

def check_cantonese_usage(vocab_word: str, cantonese_entry: str) -> bool:
    """Check if the traditional form of the vocabulary word appears in the Cantonese entry"""
    traditional_word = converter.convert(vocab_word)
    return traditional_word in cantonese_entry

def extract_cantonese_word(question: str, vocab_word: str) -> str:
    """Extract the Cantonese word/analogue used in the generated question"""
    try:
        # Use Claude to identify the Cantonese word used in the question
        system_prompt = f"""You are a Cantonese language expert. Given a vocabulary word and a generated question,
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
        
        cantonese_word = response.content[0].text.strip()
        print(f"Extracted Cantonese word: {cantonese_word}")
        return cantonese_word
    except Exception as e:
        print(f"Error extracting Cantonese word: {str(e)}")
        return vocab_word  # Fallback to original word if extraction fails

def evaluate_answer_with_claude(user_answer: str, vocab_word: str, language: str, vocab_entry: dict, generated_question: str = None) -> dict:
    """Use Claude to evaluate the answer and provide feedback"""
    
    print(f"\n=== Evaluation Request ===")
    print(f"Language: {language}")
    print(f"Vocabulary Word: {vocab_word}")
    print(f"User Answer: {user_answer}")
    
    # Check if word appears in Cantonese entry
    requires_alternative = False
    target_word = vocab_word
    if language == 'cantonese':
        cantonese_entry = vocab_entry.get('cantonese', '')
        requires_alternative = not check_cantonese_usage(vocab_word, cantonese_entry)
        print(f"Cantonese Entry: {cantonese_entry}")
        print(f"Requires Alternative: {requires_alternative}")
        
        # If alternative is required and we have a generated question, extract the Cantonese word used
        if requires_alternative and generated_question:
            target_word = extract_cantonese_word(generated_question, vocab_word)
            print(f"Using Cantonese alternative: {target_word}")
    
    # Use generated question if provided, otherwise fall back to entry
    question = generated_question if generated_question else vocab_entry.get(language.lower(), '')
    
    system_prompt = f"""You are a language evaluation assistant specializing in {language}. 
    Analyze the following answer using these criteria:

    1. Question Response: Does the answer:
       - Actually answer the question being asked: "{question}"
       - Show understanding of the question's intent
       - Provide relevant information
       - Not just repeat or rephrase the question
    
    2. Fluency: Is the sentence natural and well-constructed? Consider:
       - Grammar and word order
       - Natural expression and colloquialisms
       - Appropriate particles and measure words
    
    3. Vocabulary/Expression Usage:
       CRITICAL: Your improved answer MUST use the word '{target_word}' - this is non-negotiable.
       {"This is the Cantonese word used in the question that corresponds to the meaning of '{vocab_word}'. Use it naturally and meaningfully." if requires_alternative else f"Evaluate whether the vocabulary word '{vocab_word}' is used properly and meaningfully in the answer."}
       Consider:
       - Context appropriateness
       - Natural expression
       - Complexity beyond basic usage
    
    4. English/Romanization: Check for:
       - English word substitutions
       - Romanized filler words
       - Unnecessary mixed language usage

    IMPORTANT: You must evaluate the answer in relation to the generated question "{question}", not the original entry in the database.

    Vocabulary word: {vocab_word}
    User's answer: {user_answer}
    {"Note: This is Cantonese mode and the vocabulary word is not commonly used in Cantonese, so evaluate based on natural expression of the meaning rather than exact word usage." if requires_alternative else ""}
    
    Return your evaluation as a valid JSON object with exactly these fields:
    {{
      "fluent": boolean,           // true if sentence is natural, grammatical, and actually answers the question
      "meaningful_usage": boolean, // true if meaning is expressed well (for Cantonese alternatives) or word is used properly
      "has_fillers": boolean,     // true if English words or unnecessary romanization used
      "romanization": string,     // pinyin for Mandarin or jyutping for Cantonese, with tones
      "improved_answer": string,  // better version that MUST use the vocabulary word (or for Cantonese: the same word used in the question)
      "feedback": string         // detailed explanation of evaluation and suggestions IN ENGLISH
    }}

    IMPORTANT: Ensure your response is ONLY the JSON object, with no additional text or explanation.
    Use double quotes for strings and proper JSON syntax.
    CRITICAL: The "feedback" field MUST be written in English, even when evaluating Cantonese or Mandarin answers.

    The feedback should be constructive and specific, explaining:
    1. How well the answer addresses the question
    2. What was done well linguistically
    3. What could be improved
    4. Why any improvements are suggested
    {"5. How well the meaning is expressed in natural Cantonese" if requires_alternative else "5. How well the vocabulary word is used"}
    """

    context = {
        "vocabulary_word": vocab_word,
        "user_answer": user_answer,
        "original_entry": vocab_entry.get(language.lower(), ""),
        "requires_alternative": requires_alternative,
        "evaluation_mode": "alternative_expression" if requires_alternative else "exact_word",
        "question": question
    }

    try:
        print("\n=== Sending Request to Claude ===")
        response = client.messages.create(
            model="claude-sonnet-4-5@20250929",
            max_tokens=1000,
            temperature=0,
            messages=[{
                "role": "user",
                "content": f"""Context: {context}

Evaluation Mode: {context['evaluation_mode']}
{"Since this word is not commonly used in Cantonese, evaluate based on whether the answer expresses the same meaning naturally using appropriate Cantonese expressions. The meaningful_usage should be true if the meaning is expressed well, even without the exact vocabulary word." if requires_alternative else "Evaluate the proper usage of the specific vocabulary word."}

Please evaluate this answer."""
            }],
            system=system_prompt
        )

        # Log Claude's response
        print("\n=== Claude Response ===")
        raw_response = response.content[0].text
        print(f"Raw Response: {raw_response}")

        # Parse the JSON response - strip markdown code blocks if present
        try:
            json_text = raw_response.strip()
            if json_text.startswith('```'):
                # Remove markdown code block markers
                lines = json_text.split('\n')
                # Remove first line (```json or ```) and last line (```)
                lines = [l for l in lines if not l.strip().startswith('```')]
                json_text = '\n'.join(lines)
            evaluation = json.loads(json_text)
            print("\n=== Parsed Evaluation ===")
            print(json.dumps(evaluation, indent=2))
            return evaluation
        except json.JSONDecodeError as e:
            print(f"\n=== JSON Parse Error ===")
            print(f"Error: {str(e)}")
            print(f"Problem text: {raw_response}")
            raise
    except Exception as e:
        print(f"\n=== Evaluation Error ===")
        print(f"Error: {str(e)}")
        raise

def calculate_next_review(
    current_data: dict,
    language: str,
    had_difficulty: bool,
    evaluation: dict,
    now: datetime
) -> datetime:
    """Calculate the next review time based on various factors"""
    
    # For any difficulty or non-fluent usage, use short intervals
    if had_difficulty:
        print("Had difficulty - using IMMEDIATE interval (5 minutes)")
        return now + timedelta(minutes=INTERVALS["DIFFICULTY"]["IMMEDIATE"])
    
    if not evaluation['fluent'] or evaluation['has_fillers']:
        print("Not fluent or has fillers - using SHORT interval (15 minutes)")
        return now + timedelta(minutes=INTERVALS["DIFFICULTY"]["SHORT"])
    
    if not evaluation['meaningful_usage']:
        print("Not meaningful usage - using MEDIUM interval (30 minutes)")
        return now + timedelta(minutes=INTERVALS["DIFFICULTY"]["MEDIUM"])
    
    # For successful, fluent usage
    next_review_field = f'nextReview{language.capitalize()}'
    current_review = current_data.get(next_review_field)
    
    # If this is the first successful review or there was any difficulty recently
    if not current_review or had_difficulty or not evaluation['fluent'] or evaluation['has_fillers'] or not evaluation['meaningful_usage']:
        print("First success or recent difficulty - using INITIAL interval (3 days)")
        return now + timedelta(minutes=INTERVALS["SUCCESS"]["INITIAL"][0])
    
    # For subsequent successful reviews
    try:
        # Convert ISO string to datetime if needed
        if isinstance(current_review, str):
            current_review = datetime.fromisoformat(current_review)
        
        # Calculate time difference in minutes
        current_diff = (now - current_review.replace(tzinfo=None)).total_seconds() / 60
        intervals = INTERVALS["SUCCESS"]["INITIAL"] + INTERVALS["SUCCESS"]["SUBSEQUENT"]
        next_interval = next((i for i in intervals if i > current_diff), intervals[-1])
        print(f"Subsequent success - using interval: {next_interval} minutes")
        return now + timedelta(minutes=next_interval)
    except Exception as e:
        print(f"Error calculating interval: {str(e)}, using INITIAL interval")
        return now + timedelta(minutes=INTERVALS["SUCCESS"]["INITIAL"][0])

@functions_framework.http
def evaluate_answer(request):
    print("\n====== New Evaluation Request ======")
    
    # CORS headers
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        request_json = request.get_json()
        print("\n=== Request Parameters ===")
        print(f"Request JSON: {json.dumps(request_json, indent=2)}")
        
        doc_id = request_json.get('docId')
        language = request_json.get('language')
        user_answer = request_json.get('answer')
        had_difficulty = request_json.get('hadDifficulty', False)
        
        # Get the vocabulary document
        print("\n=== Fetching Vocabulary Document ===")
        doc_ref = db.collection('vocabulary').document(doc_id)
        doc = doc_ref.get()
        if not doc.exists:
            print(f"Document not found: {doc_id}")
            return (jsonify({'error': 'Document not found'}), 404, headers)
        
        vocab_data = doc.to_dict()
        # Convert Firestore timestamps to ISO format strings
        timestamp_fields = ['timestamp', 'nextReviewMandarin', 'nextReviewCantonese']
        for field in timestamp_fields:
            if field in vocab_data and vocab_data[field]:
                vocab_data[field] = vocab_data[field].isoformat() if hasattr(vocab_data[field], 'isoformat') else None
        print(f"Vocabulary Data: {json.dumps(vocab_data, indent=2)}")
        
        # Get the generated question from the request
        generated_question = request_json.get('generatedQuestion')
        
        # Evaluate the answer
        evaluation = evaluate_answer_with_claude(
            user_answer,
            vocab_data['simplified'],
            language,
            vocab_data,
            generated_question
        )
        
        # Calculate next review time
        now = datetime.utcnow().replace(tzinfo=None)
        print("\n=== Calculating Next Review ===")
        next_review = calculate_next_review(
            vocab_data,
            language,
            had_difficulty,
            evaluation,
            now
        )
        print(f"Next Review Time: {next_review.isoformat()}")
        
        # Update the document with UTC time
        next_review_field = f'nextReview{language.capitalize()}'
        doc_ref.update({
            next_review_field: next_review.replace(tzinfo=None)
        })
        
        # Convert datetime to Timestamp
        timestamp = Timestamp()
        timestamp.FromDatetime(next_review)
        
        # Prepare response with raw timestamp data
        response = {
            'success': True,
            'evaluation': evaluation,
            'nextReview': {
                'seconds': timestamp.seconds,
                'nanoseconds': timestamp.nanos
            },
            'intervals': INTERVALS  # Include available intervals for frontend dropdown
        }
        
        return (jsonify(response), 200, headers)

    except Exception as e:
        print(f'\n=== Error Processing Request ===')
        print(f'Error: {str(e)}')
        print(f'Error Type: {type(e).__name__}')
        import traceback
        print(f'Traceback:\n{traceback.format_exc()}')
        return (jsonify({'error': str(e)}), 500, headers)

@functions_framework.http
def update_review_time(request):
    """Endpoint to update review time after manual adjustment"""
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        request_json = request.get_json()
        doc_id = request_json.get('docId')
        language = request_json.get('language')
        new_review_time = request_json.get('newReviewTime')
        
        if not all([doc_id, language, new_review_time]):
            return (jsonify({'error': 'Missing required fields'}), 400, headers)
        
        # Parse the ISO string and preserve exact time
        review_time = datetime.fromisoformat(new_review_time)
        
        # Update the document with the exact time
        doc_ref = db.collection('vocabulary').document(doc_id)
        next_review_field = f'nextReview{language.capitalize()}'
        doc_ref.update({
            next_review_field: review_time
        })

        # Convert datetime to Timestamp for response
        timestamp = Timestamp()
        timestamp.FromDatetime(review_time)
        print(f"\n=== Time Values ===")
        print(f"Input ISO string: {new_review_time}")
        print(f"Parsed datetime: {review_time}")
        print(f"Timestamp: seconds={timestamp.seconds}, nanos={timestamp.nanos}")
        
        return (jsonify({
            'success': True,
            'nextReview': {
                'seconds': timestamp.seconds,
                'nanoseconds': timestamp.nanos
            }
        }), 200, headers)

    except Exception as e:
        print(f'Error updating review time: {str(e)}')
        return (jsonify({'error': str(e)}), 500, headers)
