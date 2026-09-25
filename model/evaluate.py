import torch
import json
import sqlite3
import os
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
from datasets import load_dataset
from tqdm import tqdm

# ── Config ────────────────────────────────────────────────────────────
BASE_MODEL = "Qwen/Qwen2.5-Coder-1.5B-Instruct"
FINETUNED_PATH = "./output-1.5b-lora"   # Path to fine-tuned model
SPIDER_DB_PATH = "./spider_databases/spider_data/database"   # downloaded databases
SCHEMA_DIR = "./spider_databases/spider_data/database"       # schema files
MAX_EVAL_SAMPLES = 1034                # start small, increase later
OUTPUT_FILE = "eval_results_1.5b_lora_v2.json"

def load_schema(db_id):
    """Load the CREATE TABLE schema from schema.sql file for a given database."""
    schema_path = os.path.join(SCHEMA_DIR, db_id, "schema.sql")
    if os.path.exists(schema_path):
        with open(schema_path, "r") as f:
            return f.read().strip()
    return db_id  # fallback to db_id if schema not found

# ── Load model ────────────────────────────────────────────────────────
print("Loading model...")
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    quantization_config=bnb_config,
    device_map="auto",
    trust_remote_code=True,
)

# Load fine-tuned LoRA weights
print(f"Loading fine-tuned model from {FINETUNED_PATH}...")
model = PeftModel.from_pretrained(model, FINETUNED_PATH)
model.eval()

tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
tokenizer.pad_token = tokenizer.eos_token

# ── Load Spider dev set ───────────────────────────────────────────────
print("Loading Spider dev set...")
spider = load_dataset("xlangai/spider")
dev_data = list(spider["validation"])[:MAX_EVAL_SAMPLES]

# ── SQL generation ────────────────────────────────────────────────────
def generate_sql(question, db_id):
    schema = load_schema(db_id)
    prompt = f"""You are an expert SQL generator. Given a database schema and a natural language question, generate ONLY the SQL query with no explanation.

### Schema:
{schema}

### Question:
{question}

### SQL:
SELECT"""
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=128,
            temperature=0.1,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    generated = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    sql = "SELECT " + generated.strip().split("\n")[0].strip()
    return sql

# ── Execution accuracy ────────────────────────────────────────────────
def execute_sql(sql, db_path):
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(sql)
        result = cursor.fetchall()
        conn.close()
        return result, None
    except Exception as e:
        return None, str(e)

def check_execution_accuracy(pred_sql, gold_sql, db_path):
    pred_result, pred_err = execute_sql(pred_sql, db_path)
    gold_result, gold_err = execute_sql(gold_sql, db_path)

    if pred_err or gold_err:
        return False
    # Compare result sets regardless of order
    return sorted(str(r) for r in pred_result) == sorted(str(r) for r in gold_result)

# ── Run evaluation ────────────────────────────────────────────────────
print(f"Evaluating on {MAX_EVAL_SAMPLES} examples...")
results = []
exact_match = 0
exec_match = 0
exec_total = 0

for example in tqdm(dev_data):
    question = example["question"]
    gold_sql = example["query"]
    db_id = example["db_id"]
    db_path = os.path.join(SPIDER_DB_PATH, db_id, f"{db_id}.sqlite")

    pred_sql = generate_sql(question, db_id)

    # Exact match
    em = pred_sql.strip().lower() == gold_sql.strip().lower()
    if em:
        exact_match += 1

    # Execution accuracy
    ex = False
    if os.path.exists(db_path):
        ex = check_execution_accuracy(pred_sql, gold_sql, db_path)
        exec_total += 1
        if ex:
            exec_match += 1

    results.append({
        "question": question,
        "gold_sql": gold_sql,
        "pred_sql": pred_sql,
        "exact_match": em,
        "exec_match": ex,
    })

# ── Report ────────────────────────────────────────────────────────────
em_score = exact_match / len(dev_data) * 100
ex_score = exec_match / exec_total * 100 if exec_total > 0 else 0

print("\n" + "=" * 40)
print("Model: Qwen2.5-Coder-1.5B Fine-Tuned (LoRA)")
print(f"Fine-tuned path: {FINETUNED_PATH}")
print(f"Samples evaluated: {len(dev_data)}")
print(f"Exact Match (EM):       {em_score:.2f}%")
print(f"Execution Accuracy (EX): {ex_score:.2f}%")
print(f"{'='*40}")

with open(OUTPUT_FILE, "w") as f:
    json.dump({
        "em": em_score,
        "ex": ex_score,
        "results": results
    }, f, indent=2)

print(f"Results saved to {OUTPUT_FILE}")