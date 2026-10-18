import sys
import pandas as pd

for path in sys.argv[1:]:
    df = pd.read_csv(path)
    print(f"\n=== {path} ===")
    print(f"{len(df)} rows, {len(df.columns)} columns\n")
    print("Column / type / non-empty:")
    for c in df.columns:
        print(f"  {c:35} {str(df[c].dtype):10} {df[c].notna().sum()}")
    print("\nFirst 3 rows:")
    print(df.head(3).to_string())