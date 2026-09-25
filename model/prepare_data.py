from datasets import load_dataset
import json
import os

# Load Spider dataset
spider = load_dataset("xlangai/spider")

# Path to schema files
SCHEMA_DIR = "./spider_databases/spider_data/database"

def load_schema(db_id):
    """Load only CREATE TABLE statements, strip INSERT INTO data."""
    schema_path = os.path.join(SCHEMA_DIR, db_id, "schema.sql")
    if os.path.exists(schema_path):
        with open(schema_path, "r") as f:
            lines = f.readlines()
        # Keep only CREATE TABLE lines, skip INSERT INTO and PRAGMA
        clean_lines = []
        for line in lines:
            stripped = line.strip().upper()
            if stripped.startswith("INSERT INTO") or stripped.startswith("PRAGMA"):
                continue
            clean_lines.append(line)
        return "".join(clean_lines).strip()
    return db_id

def format_example(example):
    db_id = example["db_id"]
    schema = load_schema(db_id)
    question = example["question"]
    query = example["query"]

    # This is the instruction format Qwen expects
    prompt = f"""You are an expert SQL generator. Given a database schema and a natural language question, generate the correct SQL query.

### Schema:
{schema}

### Question:
{question}

### SQL:
"""
    return {
        "prompt": prompt,
        "completion": query,
        "text": prompt + query
    }

# Format train and validation splits
print("Processing train split...")
with open("train.jsonl", "w") as f:
    for example in spider["train"]:
        item = format_example(example)
        f.write(json.dumps(item) + "\n")
print("Train done.")

print("Processing val split...")
with open("val.jsonl", "w") as f:
    for example in spider["validation"]:
        item = format_example(example)
        f.write(json.dumps(item) + "\n")
print("Val done.")