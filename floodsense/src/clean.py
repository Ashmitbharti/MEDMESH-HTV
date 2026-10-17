"""Step 1: clean the Water Survey of Canada daily files; check realtime files against them."""
from pathlib import Path

import pandas as pd

from .config import CLEAN_DIR, MAX_INTERP_GAP, RAIN_FILE, STATIONS, find_input

KEEP = ["DATE", "LEVEL", "DISCHARGE", "LEVEL_SYMBOL_EN", "DISCHARGE_SYMBOL_EN"]
# Symbol values whose wording suggests the reading is not a clean measurement.
SUSPECT_SYMBOLS = ("Ice Conditions", "Estimated")


def check_station_name(station: str, df: pd.DataFrame, path: Path) -> str:
    names = df["STATION_NAME"].dropna().unique()
    if len(names) != 1:
        raise SystemExit(f"{path.name}: expected one STATION_NAME, found {list(names)}")
    name = names[0]
    expected = STATIONS[station]
    ok = expected in name.upper()
    print(f"  {path.name}: STATION_NAME = {name!r} (expected to contain {expected!r}) -> {'OK' if ok else 'MISMATCH'}")
    if not ok:
        raise SystemExit(f"Station {station} does not match the expected creek. Stop.")
    if set(df["STATION_NUMBER"].unique()) != {station}:
        raise SystemExit(f"{path.name}: STATION_NUMBER column is not {station}")
    return name


def interpolate_short_gaps(s: pd.Series, max_gap: int = MAX_INTERP_GAP) -> pd.Series:
    """Linear-interpolate only NaN runs of length <= max_gap with data on both sides. Longer runs stay NaN."""
    isna = s.isna()
    run_len = isna.groupby((isna != isna.shift()).cumsum()).transform("sum")
    filled = s.interpolate(method="linear", limit_area="inside")
    mask = isna & (run_len <= max_gap) & filled.notna()
    out = s.copy()
    out[mask] = filled[mask]
    return out


def load_rain():
    path = find_input(RAIN_FILE)
    if not path.exists():
        return None
    r = pd.read_csv(path)
    r["DATE"] = pd.to_datetime(r["LOCAL_DATE"]).dt.normalize()
    cols = [c for c in ("TOTAL_PRECIPITATION", "SNOW_ON_GROUND") if c in r]
    return r.drop_duplicates("DATE").set_index("DATE").sort_index()[cols]


def merge_rain(df: pd.DataFrame, rain: pd.DataFrame, station: str) -> pd.DataFrame:
    """Join rain by date. Missing-rain runs of <= MAX_INTERP_GAP days -> 0; longer runs stay NaN
    (a train-fitted imputer handles them). `rain_missing` marks every originally missing day."""
    df = df.join(rain, how="left")
    p = df["TOTAL_PRECIPITATION"]
    df["rain_missing"] = p.isna().astype(int)
    isna = p.isna()
    run_len = isna.groupby((isna != isna.shift()).cumsum()).transform("sum")
    short = isna & (run_len <= MAX_INTERP_GAP)
    df.loc[short, "TOTAL_PRECIPITATION"] = 0.0
    print(f"    rain: {100 * (1 - isna.mean()):.1f}% of station days have Pearson precipitation; "
          f"{int(short.sum())} days in gaps <= {MAX_INTERP_GAP} filled with 0; "
          f"{int(df['TOTAL_PRECIPITATION'].isna().sum())} days left NaN (longer gaps)")
    if "SNOW_ON_GROUND" in df:
        print(f"    SNOW_ON_GROUND coverage: {100 * df['SNOW_ON_GROUND'].notna().mean():.1f}% of station days")
    return df


def clean_station(station: str, rain=None) -> pd.DataFrame:
    path = find_input(f"{station}_daily.csv")
    if not path.exists():
        raise SystemExit(f"Missing input file {path}")
    raw = pd.read_csv(path)
    name = check_station_name(station, raw, path)

    df = raw[KEEP].copy()
    df["DATE"] = pd.to_datetime(df["DATE"])
    n_dup = int(df["DATE"].duplicated().sum())
    df = df.sort_values("DATE").drop_duplicates("DATE").set_index("DATE")
    df = df.reindex(pd.date_range(df.index.min(), df.index.max(), freq="D"))
    df.index.name = "DATE"

    print(f"  {station} {name}: {df.index.min().date()} -> {df.index.max().date()}, "
          f"{len(df)} calendar days, {n_dup} duplicate dates dropped")
    for c in ("LEVEL", "DISCHARGE"):
        print(f"    % missing {c}: {100 * df[c].isna().mean():.1f}%")
    for c in ("LEVEL_SYMBOL_EN", "DISCHARGE_SYMBOL_EN"):
        vc = df[c].fillna("<blank>").value_counts()
        print(f"    {c}: " + ", ".join(f"{k}={v}" for k, v in vc.items()))

    top = df["LEVEL"] >= df["LEVEL"].quantile(0.97)
    parts = [f"{c}={sym!r}: {int((top & (df[c] == sym)).sum())}"
             for c in ("LEVEL_SYMBOL_EN", "DISCHARGE_SYMBOL_EN") for sym in SUSPECT_SYMBOLS
             if (top & (df[c] == sym)).any()]
    print(f"    top-3% LEVEL days (all years, n={int(top.sum())}) carrying ice/estimated symbols: "
          + (", ".join(parts) if parts else "none"))

    for c in ("LEVEL", "DISCHARGE"):
        before = int(df[c].isna().sum())
        df[c] = interpolate_short_gaps(df[c])
        print(f"    {c}: interpolated {before - int(df[c].isna().sum())} days (gaps <= {MAX_INTERP_GAP} days)")
    n_bad = int(df[["LEVEL", "DISCHARGE"]].isna().any(axis=1).sum())
    print(f"    {n_bad} days still missing LEVEL or DISCHARGE (kept as NaN on the calendar so lags stay aligned; "
          f"rows that need them are dropped later)")

    if rain is not None:
        df = merge_rain(df, rain, station)

    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(CLEAN_DIR / f"{station}.csv")
    return df


def load_realtime(station: str, path=None) -> pd.DataFrame:
    """5-minute realtime readings indexed by local standard time (the clock WSC daily values use)."""
    path = Path(path) if path else find_input(f"{station}_realtime.csv")
    rt = pd.read_csv(path)
    check_station_name(station, rt, path)
    t = pd.to_datetime(rt["DATETIME_LST"], utc=True).dt.tz_convert("Etc/GMT+5").dt.tz_localize(None)
    return rt.assign(DATETIME=t).set_index("DATETIME").sort_index()[["LEVEL", "DISCHARGE"]].astype(float)


def realtime_daily(rt: pd.DataFrame, min_coverage: float = 0.8) -> pd.DataFrame:
    """Per-day max/mean/min for days with at least 80% of the 288 five-minute samples."""
    agg = rt.resample("D").agg(["max", "mean", "min"])
    agg.columns = [f"{a}_{b}" for a, b in agg.columns]
    counts = rt["LEVEL"].resample("D").count()
    agg["n_samples"] = counts
    agg["complete"] = counts >= min_coverage * 288
    agg.index.name = "DATE"
    return agg


def check_realtime(station: str, clean: pd.DataFrame):
    rt = load_realtime(station)
    d = realtime_daily(rt)
    full = d[d["complete"]]
    print(f"  {station} realtime: {rt.index.min()} -> {rt.index.max()} LST, {len(rt)} rows, "
          f"{len(full)} complete days")
    for c in ("LEVEL", "DISCHARGE"):
        hist = clean[c]
        lo, hi = full[f"{c}_mean"].min(), full[f"{c}_mean"].max()
        print(f"    {c}: realtime daily mean [{lo:.3f}, {hi:.3f}] | daily file [{hist.min():.3f}, {hist.max():.3f}], "
              f"median {hist.median():.3f}")
        if lo < hist.min() - 3 * hist.std() or hi > hist.max() + 3 * hist.std():
            raise SystemExit(f"{station} {c}: realtime values far outside the daily-file range; check units/datum.")
    print(f"    units/range check passed for {station}")


def run():
    print("\n=== STEP 1: clean ===")
    rain = load_rain()
    if rain is None:
        print(f"  Rain file {RAIN_FILE} NOT found -> running WITHOUT rain (features: LEVEL, DISCHARGE only).")
    cleaned = {}
    for s in STATIONS:
        cleaned[s] = clean_station(s, rain)
        check_realtime(s, cleaned[s])
    usable = {s: int(d[["LEVEL", "DISCHARGE"]].notna().all(axis=1).sum()) for s, d in cleaned.items()}
    print(f"Step 1 summary: {len(cleaned)} stations cleaned to {CLEAN_DIR}; days with LEVEL and DISCHARGE: "
          f"{usable}; rain {'used' if rain is not None else 'absent'}.")
    return cleaned, rain is not None
