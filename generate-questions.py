#!/usr/bin/env python3
"""
Generate daily Chinese-to-English travel translation quiz questions using Claude API.
Called by GitHub Actions workflow. Outputs JSON to questions/YYYY-MM-DD.json.
"""

import json
import os
import sys
from datetime import datetime, timedelta

try:
    import anthropic
except ImportError:
    print("Error: anthropic package not installed. Run: pip install anthropic")
    sys.exit(1)

# ---- Configuration ----
MODEL = "claude-sonnet-4-6"
CATEGORIES = [
    {"key": "hotel", "label_zh": "酒店住宿", "desc": "booking, check-in/out, complaints, amenities"},
    {"key": "dining", "label_zh": "餐饮美食", "desc": "ordering, dietary needs, paying the bill, local cuisine"},
    {"key": "transport", "label_zh": "交通出行", "desc": "directions, tickets, delays, rental, rideshare"},
    {"key": "shopping", "label_zh": "购物消费", "desc": "bargaining, returns, sizes, tax refund"},
    {"key": "directions", "label_zh": "问路指路", "desc": "asking for directions, landmarks, distance, navigation"},
    {"key": "emergency", "label_zh": "紧急情况", "desc": "lost items, police, theft, consulate"},
    {"key": "sightseeing", "label_zh": "观光游览", "desc": "tickets, guided tours, opening hours, photography"},
    {"key": "customs", "label_zh": "海关入境", "desc": "declaration, visa, luggage inspection, duty-free"},
    {"key": "medical", "label_zh": "医疗健康", "desc": "pharmacy, symptoms, insurance, hospital"},
    {"key": "social", "label_zh": "社交礼仪", "desc": "greetings, small talk, tipping, cultural etiquette"},
]

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "date": {"type": "string"},
        "difficulty": {"type": "string"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "category": {"type": "string"},
                    "category_label_zh": {"type": "string"},
                    "chinese": {"type": "string"},
                    "reference_answers": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "key_phrases": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "chinese": {"type": "string"},
                                "english": {"type": "string"},
                            },
                            "required": ["chinese", "english"],
                            "additionalProperties": False,
                        },
                    },
                    "grading_focus": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["id", "category", "category_label_zh", "chinese", "reference_answers", "key_phrases", "grading_focus"],
                "additionalProperties": False,
            },
        },
        "metadata": {
            "type": "object",
            "properties": {
                "model": {"type": "string"},
                "generated_at": {"type": "string"},
                "total_questions": {"type": "integer"},
            },
            "required": ["model", "generated_at", "total_questions"],
            "additionalProperties": False,
        },
    },
    "required": ["date", "difficulty", "questions", "metadata"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You are a Chinese-to-English translation exercise designer for intermediate-level English learners who are travelers.

Your task: Generate exactly 10 translation questions per day.

Requirements:
- Each question is a Chinese sentence (15-30 characters, intermediate difficulty) that a traveler would encounter or need to say
- Sentences should be natural, practical, and NOT simple single-clause beginner sentences
- Aim for compound sentences, conditional structures, or polite request patterns common in travel
- Categories must cover at least 6 different travel dimensions
- Each question needs 2 reference English translations (natural and idiomatic)
- Include 2-3 key phrases per question with Chinese-English vocabulary pairs
- Include 2-3 grading focus points per question (specific aspects to evaluate)

Category list with descriptions:"""

def build_prompt(target_date: str) -> str:
    cat_list = "\n".join([f"- {c['key']} ({c['label_zh']}): {c['desc']}" for c in CATEGORIES])
    system = SYSTEM_PROMPT + "\n" + cat_list
    user = f"Generate 10 questions for date {target_date}. Make sentences practical and at intermediate difficulty — think B1-B2 CEFR level. Include a variety of sentence structures (conditionals, indirect questions, polite requests, compound sentences)."
    return system, user


def generate(target_date: str) -> dict:
    client = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY env var

    system_prompt, user_prompt = build_prompt(target_date)

    response = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
        extra_body={
            "output_config": {
                "format": {
                    "type": "json_schema",
                    "schema": QUESTION_SCHEMA,
                }
            }
        },
    )

    text = response.content[0].text
    data = json.loads(text)

    # Enrich metadata
    data["date"] = target_date
    data["difficulty"] = "intermediate"
    data["metadata"] = {
        "model": MODEL,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "total_questions": len(data.get("questions", [])),
    }

    return data


def main():
    # Target date: tomorrow (so questions are ready before users need them)
    tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    # Allow override via command line
    if len(sys.argv) > 1:
        tomorrow = sys.argv[1]

    output_path = os.path.join("questions", f"{tomorrow}.json")

    # Idempotency: skip if file already exists
    if os.path.exists(output_path):
        print(f"File already exists: {output_path}. Skipping.")
        return

    print(f"Generating questions for {tomorrow}...")

    try:
        data = generate(tomorrow)
    except Exception as e:
        print(f"Error generating questions: {e}")
        sys.exit(1)

    os.makedirs("questions", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Successfully wrote {output_path} ({data['metadata']['total_questions']} questions)")


if __name__ == "__main__":
    main()