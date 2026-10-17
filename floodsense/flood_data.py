#!/usr/bin/env python3
"""
MedMesh flood data helper (Environment and Climate Change Canada open data).

Pulls water level / flow for a Water Survey of Canada station, finds nearby
rainfall stations, pulls daily rainfall, and counts high-water events so you
can tell quickly whether a station has enough events to train on.

Setup:   pip install requests pandas
Run:     python flood_data.py info 02HC033
         python flood_data.py daily 02HC033 --start 2000-01-01
         python flood_data.py realtime 02HC033
         python flood_data.py rain-stations 02HC033 --start 2024-07-01 --end 2024-07-31
         python flood_data.py rain <CLIMATE_IDENTIFIER> --start 2000-01-01 --end 2026-10-01
         python flood_data.py events 02HC033_daily.csv --pct 97

NOTE: written against the documented GeoMet OGC API. Column names are
discovered at run time and printed, because I could not confirm every field
name in advance. If a command fails, send me the printed columns / error.
"""
import argparse
import sys
import time

import pandas as pd
import requests

API = "https://api.weather.gc.ca/collections"
HEADERS = {"User-Agent": "medmesh-hackathon/0.1"}


def get_json(url, params=None, tries=4):
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=60)
            if r.status_code == 200:
                return r.json()
            print(f"HTTP {r.status_code} for {r.url}", file=sys.stderr)
        except requests.RequestException as e:
            print(f"request error: {e}", file=sys.stderr)
        time.sleep(2 ** i)
    raise SystemExit("API request failed repeatedly. Check your connection and the station number.")


def fetch_items(collection, params, page=5000, max_rows=2_000_000):
    """Page through a feature collection and return the properties as a DataFrame."""
    rows, offset = [], 0
    while True:
        p = dict(params, f="json", limit=page, offset=offset)
        data = get_json(f"{API}/{collection}/items", p)
        feats = data.get("features", [])
        rows.extend(dict(f.get("properties", {})) for f in feats)
        print(f"  fetched {len(rows)} rows from {collection}...", file=sys.stderr)
        if len(feats) < page or len(rows) >= max_rows:
            break
        offset += page
    return pd.DataFrame(rows)


def pick(df, *needles, exclude=("SYMBOL", "FLAG", "QUALIF")):
    """Find the first column whose name contains all needles (case-insensitive)."""
    for c in df.columns:
        u = c.upper()
        if all(n in u for n in needles) and not any(x in u for x in exclude):
            return c
    return None


def station_xy(station):
    data = get_json(f"{API}/hydrometric-stations/items/{station}", {"f": "json"})
    coords = (data.get("geometry") or {}).get("coordinates")
    if not coords:
        raise SystemExit(f"No coordinates found for station {station}. Is the number right?")
    return coords[0], coords[1], data.get("properties", {})


def cmd_info(a):
    x, y, props = station_xy(a.station)
    print(f"Station {a.station}  lon={x}  lat={y}")
    for k, v in props.items():
        print(f"  {k}: {v}")


def cmd_daily(a):
    df = fetch_items(
        "hydrometric-daily-mean",
        {"STATION_NUMBER": a.station, "datetime": f"{a.start}/..", "sortby": "DATE"},
    )
    if df.empty:
        raise SystemExit("No daily data returned. Check the station number and start date.")
    out = f"{a.station}_daily.csv"
    df.to_csv(out, index=False)
    print(f"Saved {len(df)} rows to {out}")
    print("Columns:", list(df.columns))
    for name in ("LEVEL", "DISCHARGE"):
        c = pick(df, name)
        if c:
            print(f"  {c}: {df[c].notna().sum()} non-empty values")
    d = pick(df, "DATE")
    if d:
        print(f"  date range: {df[d].min()} to {df[d].max()}")


def cmd_realtime(a):
    df = fetch_items("hydrometric-realtime", {"STATION_NUMBER": a.station})
    if df.empty:
        raise SystemExit("No real-time data returned. The station may be inactive or not real-time.")
    out = f"{a.station}_realtime.csv"
    df.to_csv(out, index=False)
    print(f"Saved {len(df)} rows to {out}")
    print("Columns:", list(df.columns))
    d = pick(df, "DATE")
    if d:
        ts = pd.to_datetime(df[d], utc=True).sort_values()
        print(f"  range: {ts.iloc[0]} to {ts.iloc[-1]}")
        if len(ts) > 2:
            print(f"  typical time step: {ts.diff().median()}")


def cmd_rain_stations(a):
    x, y, _ = station_xy(a.station)
    d = a.radius
    bbox = f"{x - d},{y - d},{x + d},{y + d}"
    df = fetch_items("climate-daily", {"bbox": bbox, "datetime": f"{a.start}/{a.end}"},
                     page=2000, max_rows=50000)
    if df.empty:
        raise SystemExit("No climate stations found in that box/period. Try --radius 0.3 or other dates.")
    idc, name, pc = pick(df, "CLIMATE_IDENTIFIER"), pick(df, "STATION_NAME"), pick(df, "TOTAL_PRECIP")
    print("Columns:", list(df.columns))
    if not (idc and pc):
        raise SystemExit("Could not find the identifier/precipitation columns; send me the column list above.")
    g = df.groupby([idc, name] if name else [idc]).agg(days=(idc, "size"), precip_days=(pc, "count"))
    print(g.sort_values("precip_days", ascending=False).to_string())
    print("\nPick one with the most precip_days, then run:  python flood_data.py rain <id> --start ... --end ...")


def cmd_rain(a):
    df = fetch_items("climate-daily",
                     {"CLIMATE_IDENTIFIER": a.climate_id, "datetime": f"{a.start}/{a.end}"},
                     page=2000)
    if df.empty:
        raise SystemExit("No data for that climate identifier/period.")
    d = pick(df, "LOCAL_DATE") or pick(df, "DATE")
    if d:
        df = df.sort_values(d)
    out = f"{a.climate_id}_rain_daily.csv"
    df.to_csv(out, index=False)
    pc = pick(df, "TOTAL_PRECIP")
    print(f"Saved {len(df)} rows to {out}")
    print("Columns:", list(df.columns))
    if pc:
        print(f"  {pc}: {df[pc].notna().sum()} non-empty values")


def cmd_events(a):
    df = pd.read_csv(a.csv)
    dcol = a.date_col or pick(df, "DATE")
    lcol = a.col or pick(df, "LEVEL")
    if not (dcol and lcol):
        raise SystemExit(f"Could not find date/level columns in {list(df.columns)}. Use --date-col / --col.")
    s = pd.Series(pd.to_numeric(df[lcol], errors="coerce").values,
                  index=pd.to_datetime(df[dcol], utc=True)).sort_index().dropna()
    if s.empty:
        raise SystemExit(f"Column {lcol} has no numeric values. Try --col with the flow column.")
    thr = s.quantile(a.pct / 100)
    above = s > thr
    run_id = (above != above.shift()).cumsum()
    runs = [(g.index[0], g.index[-1], g.max()) for _, g in s[above].groupby(run_id[above])]
    merged, gap = [], pd.Timedelta(days=a.gap_days)
    for r in runs:
        if merged and r[0] - merged[-1][1] < gap:
            merged[-1] = (merged[-1][0], r[1], max(merged[-1][2], r[2]))
        else:
            merged.append(r)
    print(f"Using {lcol} over {s.index.min().date()} to {s.index.max().date()} ({len(s)} values)")
    print(f"Threshold = {a.pct}th percentile = {thr:.3f}")
    print(f"High-water events (merged if closer than {a.gap_days} days): {len(merged)}")
    for st, en, mx in sorted(merged, key=lambda e: -e[2])[:15]:
        print(f"  {st.date()} -> {en.date()}  peak {mx:.3f}")
    if len(merged) < 30:
        print("\nFewer than ~30 events: lower --pct (e.g. 95) or use a longer record before trusting a model.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("info"); s.add_argument("station"); s.set_defaults(fn=cmd_info)

    s = sub.add_parser("daily"); s.add_argument("station")
    s.add_argument("--start", default="2000-01-01"); s.set_defaults(fn=cmd_daily)

    s = sub.add_parser("realtime"); s.add_argument("station"); s.set_defaults(fn=cmd_realtime)

    s = sub.add_parser("rain-stations"); s.add_argument("station")
    s.add_argument("--start", required=True); s.add_argument("--end", required=True)
    s.add_argument("--radius", type=float, default=0.15, help="degrees around the gauge")
    s.set_defaults(fn=cmd_rain_stations)

    s = sub.add_parser("rain"); s.add_argument("climate_id")
    s.add_argument("--start", required=True); s.add_argument("--end", required=True)
    s.set_defaults(fn=cmd_rain)

    s = sub.add_parser("events"); s.add_argument("csv")
    s.add_argument("--pct", type=float, default=97.0)
    s.add_argument("--gap-days", type=float, default=2.0)
    s.add_argument("--col"); s.add_argument("--date-col")
    s.set_defaults(fn=cmd_events)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()