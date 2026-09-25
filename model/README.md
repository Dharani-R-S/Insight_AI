# model/

This folder contains the fine-tuning research and the trained LoRA adapter
for the **local SQL generation** feature in Insight AI.

## What's inside

```
model/
├── adapter/                ← Trained LoRA adapter (used by the app at runtime)
│   ├── adapter_config.json
│   ├── adapter_model.safetensors
│   ├── tokenizer.json
│   └── tokenizer_config.json
├── finetune.py             ← Training script
├── evaluate.py             ← Evaluation script
├── prepare_data.py         ← Data preparation script
└── pyproject.toml          ← Python dependencies for training
```

## How it works

The app uses **Qwen2.5-Coder-1.5B-Instruct** as the base model (downloaded
automatically from HuggingFace on first run) and loads the `adapter/` files
on top of it. This technique is called **LoRA** — instead of storing a 3 GB
model, we only store a small 28 MB "patch" that specialises the model for
SQL generation.

## Setup (for running the AI feature locally)

### Requirements
- Python 3.10+
- NVIDIA GPU with CUDA (recommended — CPU works but is very slow)

### Install dependencies

```fish
cd model
python -m venv .venv
source .venv/bin/activate   # bash: source .venv/bin/activate
                             # fish: source .venv/bin/activate.fish
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install transformers peft bitsandbytes accelerate pandas plotly kaleido scikit-learn
```

### First run note
The first query will take ~15–20 seconds while the base model downloads
from HuggingFace and loads into GPU memory. All subsequent queries take ~8s.

## Re-training the model

If you want to re-train on new data:

```bash
python prepare_data.py     # prepare train/val datasets
python finetune.py         # train — outputs to adapter/
python evaluate.py         # evaluate on Spider benchmark
```
