"""Combine the two Toronto Pearson climate records into data/6158731_rain_daily.csv.

ECCC split Pearson into two climate IDs:
  6158733  TORONTO LESTER B. PEARSON INT'L A   2000 -> 2013-06 (precipitation)
  6158731  TORONTO INTL A                       2013-06-13 -> present
Raw downloads (made with `flood_data.py rain <id> --start ... --end ...`) live in data/rain_download/.
Where both report a day, the newer station (6158731) wins.

python -m src.fetch_rain
"""
import pandas as pd

from .config import DATA_DIR, RAIN_FILE

RAW = DATA_DIR / "rain_download"
KEEP = ["LOCAL_DATE", "STATION_NAME", "CLIMATE_IDENTIFIER", "TOTAL_PRECIPITATION", "TOTAL_RAIN", "TOTAL_SNOW",
        "SNOW_ON_GROUND"]


def main():
    new = pd.read_csv(RAW / "6158731_rain_daily.csv")[KEEP]
    old = pd.read_csv(RAW / "6158733_rain_daily.csv")[KEEP]
    for d in (new, old):
        d["LOCAL_DATE"] = pd.to_datetime(d["LOCAL_DATE"]).dt.normalize()
    old = old[old["TOTAL_PRECIPITATION"].notna() | ~old["LOCAL_DATE"].isin(new["LOCAL_DATE"])]
    both = pd.concat([new, old[~old["LOCAL_DATE"].isin(new.loc[new["TOTAL_PRECIPITATION"].notna(), "LOCAL_DATE"])]])
    both = both.sort_values("LOCAL_DATE").drop_duplicates("LOCAL_DATE", keep="first")
    both.to_csv(DATA_DIR / RAIN_FILE, index=False)
    print(f"Wrote {DATA_DIR / RAIN_FILE}: {len(both)} days, {both['LOCAL_DATE'].min().date()} -> "
          f"{both['LOCAL_DATE'].max().date()}")
    print(both.groupby("CLIMATE_IDENTIFIER")["LOCAL_DATE"].agg(["min", "max", "count"]).to_string())


if __name__ == "__main__":
    main()
