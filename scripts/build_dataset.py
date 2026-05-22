from datasets import load_dataset
import pandas as pd

def generate_csv():
    print("⏳ Connecting to Hugging Face Hub...")
    
    # Load the deepset/prompt-injections dataset
    # This dataset contains 'text' and a 'label' (1 for malicious injection, 0 for safe)
    try:
        dataset = load_dataset("deepset/prompt-injections", split="train")
    except Exception as e:
        print(f"❌ Failed to download dataset: {e}")
        return

    print("✅ Dataset downloaded. Formatting data...")
    
    # Convert to a Pandas DataFrame
    df = pd.DataFrame(dataset)

    # Rename columns to match what evaluate_pipeline.py expects
    df = df.rename(columns={"text": "prompt", "label": "is_malicious"})

    # Ensure we have a balanced dataset to test False Positives and False Negatives equally
    # We will grab 500 malicious prompts and 500 safe prompts
    try:
        malicious_df = df[df['is_malicious'] == 1].sample(n=500, random_state=42)
        safe_df = df[df['is_malicious'] == 0].sample(n=500, random_state=42)
    except ValueError:
        print("Dataset doesn't have enough rows for 500 of each. Using all available data.")
        malicious_df = df[df['is_malicious'] == 1]
        safe_df = df[df['is_malicious'] == 0]

    # Combine and shuffle the rows so they hit the proxy in a random order
    final_df = pd.concat([malicious_df, safe_df]).sample(frac=1, random_state=42).reset_index(drop=True)

    # Save to the CSV file expected by our evaluation script
    final_df.to_csv("adversarial_dataset.csv", index=False)
    
    print("\n" + "="*50)
    print(f"🎯 SUCCESS! Created adversarial_dataset.csv")
    print(f"Total Prompts: {len(final_df)}")
    print(f"Malicious (1): {len(malicious_df)}")
    print(f"Safe (0)     : {len(safe_df)}")
    print("="*50)
    print("You can now run: python evaluate_pipeline.py")

if __name__ == "__main__":
    generate_csv()