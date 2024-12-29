# Chinese Conversation Backend

This backend provides Cloud Functions for evaluating Chinese language responses and managing review scheduling.

## Functions

1. `evaluate_answer`: Evaluates user answers using Claude AI and schedules next review
2. `update_review_time`: Allows manual adjustment of review times

## Deployment

1. Set up environment:
```bash
# Install gcloud CLI if not already installed
# https://cloud.google.com/sdk/docs/install

# Login to Google Cloud
gcloud auth login

# Set project
gcloud config set project wz-data-catalog-demo
```

2. Install dependencies locally first to test:
```bash
python -m pip install -r requirements.txt
```

3. Deploy functions:
```bash
# Deploy evaluate_answer function
gcloud functions deploy evaluate_answer \
  --runtime python310 \
  --trigger-http \
  --allow-unauthenticated \
  --region us-central1 \
  --env-vars-file .env.yaml \
  --memory 1024MB \
  --timeout 300s

# Deploy update_review_time function
gcloud functions deploy update_review_time \
  --runtime python310 \
  --trigger-http \
  --allow-unauthenticated \
  --region us-central1 \
  --env-vars-file .env.yaml \
  --memory 256MB \
  --timeout 60s
```

Note: The evaluate_answer function needs more memory and a longer timeout because it uses Claude for evaluation. The update_review_time function can use minimal resources since it only updates a timestamp.

3. Create .env.yaml with:
```yaml
PROJECT_ID: "wz-data-catalog-demo"
```

## Development

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run locally:
```bash
functions-framework --target evaluate_answer --debug
```

## Evaluation Criteria

The function evaluates answers based on:
1. Fluency: Natural and grammatically correct language
2. Meaningful Usage: Proper use of vocabulary in context
3. English/Romanization: Checking for filler words
4. Context: Understanding of word meaning and usage

For Cantonese specifically:
- Handles alternative expressions when formal words have colloquial equivalents
- Considers Hong Kong Cantonese usage patterns
- More lenient with written characters that have standard spoken equivalents

## Review Scheduling

Intervals are based on:
- Immediate (5min): When user marks difficulty
- Short (15min): Non-fluent usage or English fillers
- Medium (30min): Basic correct usage
- Success: Progressive intervals (1h → 4h → 1d → 3d → 7d)
