import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer, SFTConfig
from datasets import load_dataset
import argparse

# ── Args ──────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--model", default="Qwen/Qwen2.5-Coder-1.5B-Instruct")
parser.add_argument("--method", choices=["lora", "qlora"], default="qlora")
parser.add_argument("--output", default="./output")
args = parser.parse_args()

print(f"Model: {args.model} | Method: {args.method}")

# ── Quantization config (only for QLoRA) ──────────────────────────────
bnb_config = None
if args.method == "qlora":
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

# ── Load model ────────────────────────────────────────────────────────
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = AutoModelForCausalLM.from_pretrained(
    args.model,
    quantization_config=bnb_config,
    trust_remote_code=True,
)
model.to(device)
model.config.use_cache = False

tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "right"

# ── LoRA config ───────────────────────────────────────────────────────
lora_config = LoraConfig(
    r=16,                        # Rank — higher = more trainable params
    lora_alpha=32,               # Scaling factor
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM,
)

if args.method == "lora":
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

# ── Dataset ───────────────────────────────────────────────────────────
dataset = load_dataset("json", data_files={
    "train": "train.jsonl",
    "validation": "val.jsonl"
})

# ── Training config ───────────────────────────────────────────────────
training_args = SFTConfig(
    output_dir=args.output,
    num_train_epochs=3,
    per_device_train_batch_size=4,
    per_device_eval_batch_size=2,
    gradient_accumulation_steps=2,
    gradient_checkpointing=True,
    learning_rate=2e-4,
    bf16=True,
    logging_steps=50,
    eval_strategy="steps",
    eval_steps=200,
    save_steps=500,
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",
    report_to="none",           # Change to "wandb" if you want logging
    dataset_text_field="text",
    max_length=512,
)

# ── Trainer ───────────────────────────────────────────────────────────
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset["train"],
    eval_dataset=dataset["validation"],
    peft_config=lora_config if args.method == "qlora" else None,
    # max_seq_length=512,
)

trainer.train()
trainer.save_model(args.output)
print(f"Model saved to {args.output}")