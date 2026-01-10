from fastapi import FastAPI
from transformers import pipeline

app = FastAPI()

# Load the RoBERTa political ideology model
classifier = pipeline(
    "text-classification",
    model="kartiksrma/roberta-political-ideology-classifier"
)

@app.post("/classify")
def classify_text(data: dict):
    text = data.get("text", "")
    result = classifier(text)
    return result