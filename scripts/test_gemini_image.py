#!/usr/bin/env python3
import base64
import os
import sys
from pathlib import Path
from google import genai

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_AISTUDIO_API_KEY")
if not api_key:
    print("Error: GEMINI_API_KEY or GOOGLE_AISTUDIO_API_KEY must be set.", file=sys.stderr)
    sys.exit(1)

client = genai.Client(api_key=api_key)

prompt = sys.argv[1] if len(sys.argv) > 1 else "A minimalist red paper origami boat floating on calm water, high contrast, cinematic."
output_path = Path(sys.argv[2] if len(sys.argv) > 2 else "output_test.png")

generation_config = {
    'temperature': 1,
    'max_output_tokens': 65536,
    'top_p': 0.95,
    'thinking_level': 'minimal',
    'image_config': {
        'image_size': '1K',
    },
}

print(f"Submitting prompt: \"{prompt}\"...")

interaction = client.interactions.create(
    model='models/gemini-3.1-flash-lite-image',
    input=prompt,
    generation_config=generation_config,
    response_modalities=['image', 'text'],
)

image_saved = False
for step in getattr(interaction, 'steps', []):
    if step.type == 'model_output' and step.content:
        for part in step.content:
            if part.type == 'text' and getattr(part, 'text', None):
                print(f"Model text: {part.text}")
            elif part.type == 'image' and getattr(part, 'data', None):
                data = base64.b64decode(part.data)
                output_path.write_bytes(data)
                print(f"Saved generated image ({len(data)} bytes) to {output_path.resolve()}")
                image_saved = True

if not image_saved:
    print("Full interaction response:")
    print(interaction)
