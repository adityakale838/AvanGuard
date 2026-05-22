import asyncio
import httpx
import pandas as pd
import time
from sklearn.metrics import classification_report, confusion_matrix, precision_score, recall_score, f1_score
from tqdm.asyncio import tqdm

# --- CONFIGURATION ---
PROXY_URL = "http://127.0.0.1:8000/v1/chat/completions"
DATASET_PATH = "data/adversarial_dataset.csv"
# Throttled to 5 concurrent requests to maintain stable GPU VRAM limits during local inference
CONCURRENCY_LIMIT = 5  
TIMEOUT_SECONDS = 120.0

async def test_single_prompt(client, semaphore, index, prompt, is_malicious):
    """Sends a single prompt through the AvanGuard pipeline and records the result."""
    async with semaphore:
        payload = {
            "model": "llama3",
            "messages": [{"role": "user", "content": prompt}]
        }
        
        try:
            response = await client.post(PROXY_URL, json=payload, timeout=TIMEOUT_SECONDS)
            
            # AvanGuard architecture: 200 means Passed, 403 means Blocked by a Guard
            was_blocked = response.status_code == 403
            reason = response.json().get("detail", "Passed") if was_blocked else "Passed"
            
            return {
                "index": index,
                "prompt": prompt,
                "ground_truth_malicious": is_malicious,
                "pipeline_blocked": was_blocked,
                "reason": reason,
                "error": None
            }
            
        except Exception as e:
            return {
                "index": index,
                "prompt": prompt,
                "ground_truth_malicious": is_malicious,
                "pipeline_blocked": None,
                "reason": "CONNECTION_ERROR",
                "error": str(e)
            }

async def run_evaluation(df):
    """Orchestrates the async streaming of the dataset through the proxy."""
    semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
    
    # We use a single AsyncClient connection pool for performance
    async with httpx.AsyncClient() as client:
        tasks = []
        for index, row in df.iterrows():
            # Expected CSV columns: 'prompt' (text) and 'is_malicious' (boolean 1 or 0)
            task = test_single_prompt(client, semaphore, index, row['prompt'], bool(row['is_malicious']))
            tasks.append(task)
            
        # Execute tasks concurrently with a progress bar
        results = await tqdm.gather(*tasks, desc="Evaluating Pipeline")
        return results

def print_academic_report(results_df, total_time):
    """Formats the output into a clean, reproducible metrics report."""
    # Filter out connection errors before calculating ML metrics
    valid_results = results_df[results_df['error'].isnull()]
    errors = len(results_df) - len(valid_results)
    
    y_true = valid_results['ground_truth_malicious'].astype(int)
    y_pred = valid_results['pipeline_blocked'].astype(int)
    
    print("\n" + "="*60)
    print(" 🛡️ AVANGUARD EMPIRICAL EVALUATION REPORT ")
    print("="*60)
    
    print(f"\n[SYSTEM PERFORMANCE]")
    print(f"Total Prompts Processed : {len(valid_results)}")
    print(f"Total Connection Errors : {errors}")
    print(f"Total Execution Time    : {total_time:.2f} seconds")
    if len(valid_results) > 0:
        print(f"Average Latency / Prompt: {(total_time / len(valid_results)):.2f} seconds")
    
    print("\n[SECURITY METRICS (Malicious Detection)]")
    # Using zero_division=0 to prevent warnings if the dataset is skewed
    precision = precision_score(y_true, y_pred, zero_division=0)
    recall = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)
    
    print(f"Precision : {precision:.4f} (Minimizes False Positives)")
    print(f"Recall    : {recall:.4f} (Minimizes False Negatives)")
    print(f"F1-Score  : {f1:.4f} (Overall Robustness)")
    
    print("\n[CONFUSION MATRIX]")
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()
    print(f"True Negatives (Safe passed)     : {tn}")
    print(f"False Positives (Safe blocked)   : {fp}  <-- Traditional WAF failure point")
    print(f"False Negatives (Threat bypassed): {fn}  <-- Critical Security failure")
    print(f"True Positives (Threat blocked)  : {tp}")
    
    print("\n" + "="*60 + "\n")

if __name__ == "__main__":
    # 1. Load the Dataset
    try:
        print("Loading dataset...")
        df = pd.read_csv(DATASET_PATH)
        required_cols = {'prompt', 'is_malicious'}
        if not required_cols.issubset(df.columns):
            raise ValueError(f"CSV must contain columns: {required_cols}")
    except FileNotFoundError:
        print(f"Error: Could not find '{DATASET_PATH}'. Please create it.")
        exit(1)
        
    # 2. Run the async evaluation
    start_time = time.time()
    results = asyncio.run(run_evaluation(df))
    end_time = time.time()
    
    # 3. Analyze and Export Results
    results_df = pd.DataFrame(results)
    
    # Save the detailed log for review (useful for identifying exactly which prompts bypassed the guard)
    results_df.to_csv("data/evaluation_results_log.csv", index=False)
    print("\nDetailed log saved to 'data/evaluation_results_log.csv'")    
    # Print the final metrics
    print_academic_report(results_df, end_time - start_time)