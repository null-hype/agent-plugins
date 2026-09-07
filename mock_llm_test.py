import os
os.environ["OPENAI_API_KEY"] = "dummy"

from llama_index.llms.mock import MockLLM
print(MockLLM)
