"""Model B step 1: hourly rain per gauge (ECCC GeoMet `climate-hourly`, PRECIP_AMOUNT).

For each gauge, hourly-capable climate stations are tried from nearest to farthest:
  * a cheap pre-check samples July of up to five years inside the gauge period; a station whose
    sampled months have no PRECIP_AMOUNT at all is rejected without a full pull (Pearson and Buttonville
    publish hourly rows but no hourly precipitation);
  * otherwise the full hourly record over the gauge period is pulled, cached in data/rain_hourly/{id}.csv,
    and accepted if PRECIP_AMOUNT is non-missing for >= 70% of hours in the gauge period;
  * stations farther than MAX_KM (25 km, the same limit used to warn on daily rain) are not used.
If nothing qualifies the gauge is marked "RATE: intensity features SKIPPED" and only daily-based drainage
proxies are built for it. Failed pulls are reported, not retried around.
"""
import contextlib
import io
import json
import sys

import numpy as np
import pandas as pd

from .config import DATA_DIR, RAIN_DIR, ROOT
from .gauges import haversine_km, load_gauges

sys.path.insert(0, str(ROOT))
import flood_data as fd  # noqa: E402

HOURLY_DIR = DATA_DIR / "rain_hourly"
MAX_MISSING = 0.30
MAX_KM = 25.0
CANDIDATES = RAIN_DIR / "hourly_candidates.csv"


def _pull(params, page=10000, max_rows=400_000):
    with contextlib.redirect_stderr(io.StringIO()):
        return fd.fetch_items("climate-hourly", params, page=page, max_rows=max_rows)


def sample_check(cid, first, last):
    yrs = sorted({y for y in np.linspace(first.year, last.year, 5).round().astype(int)})
    found, rows = 0, 0
    for y in yrs:
        d = _pull({"CLIMATE_IDENTIFIER": cid, "datetime": f"{y}-07-01/{y}-07-31"}, page=1000, max_rows=2000)
        if not d.empty:
            rows += len(d)
            found += int(d["PRECIP_AMOUNT"].notna().sum())
    return rows, found, yrs


def pull_hourly(cid, first, last):
    HOURLY_DIR.mkdir(parents=True, exist_ok=True)
    cache = HOURLY_DIR / f"{cid}.csv"
    if cache.exists():
        h = pd.read_csv(cache, parse_dates=["LOCAL_DATE"])
    else:
        d = _pull({"CLIMATE_IDENTIFIER": cid, "datetime": "2000-01-01/2025-12-31", "sortby": "LOCAL_DATE"})
        if d.empty:
            return None, []
        cols = list(d.columns)
        d[["LOCAL_DATE", "PRECIP_AMOUNT", "PRECIP_AMOUNT_FLAG"]].to_csv(cache, index=False)
        (HOURLY_DIR / f"{cid}_columns.json").write_text(json.dumps(cols))
        h = pd.read_csv(cache, parse_dates=["LOCAL_DATE"])
    cols = json.loads((HOURLY_DIR / f"{cid}_columns.json").read_text())
    s = pd.Series(pd.to_numeric(h["PRECIP_AMOUNT"], errors="coerce").to_numpy(), index=h["LOCAL_DATE"])
    return s[~s.index.duplicated()].sort_index(), cols


def coverage(s, first, last):
    hours = pd.date_range(first, last + pd.Timedelta(hours=23), freq="h")
    return float(s.reindex(hours).notna().mean())


def choose_all(stations=None):
    g = load_gauges()
    if stations:
        g = g.loc[stations]
    cand = pd.read_csv(CANDIDATES, dtype={"CLIMATE_IDENTIFIER": str})
    cand["HLY_FIRST_DATE"] = pd.to_datetime(cand["HLY_FIRST_DATE"])
    cand["HLY_LAST_DATE"] = pd.to_datetime(cand["HLY_LAST_DATE"])
    print("\n=== Model B step 1: hourly rain per gauge (climate-hourly, PRECIP_AMOUNT) ===")
    checked, pulled, choice = {}, {}, {}
    for st, row in g.iterrows():
        first, last = pd.Timestamp(row["first"]), pd.Timestamp(row["last"])
        c = cand[(cand["HLY_FIRST_DATE"] <= last) & (cand["HLY_LAST_DATE"] >= first)].copy()
        c["km"] = haversine_km(row["lat"], row["lon"], c["lat"].to_numpy(), c["lon"].to_numpy())
        c = c.sort_values("km")
        notes, chosen = [], None
        for _, cc in c.iterrows():
            cid, km = cc["CLIMATE_IDENTIFIER"], float(cc["km"])
            if km > MAX_KM:
                notes.append(f"stop: next candidate {cid} {cc['STATION_NAME'][:22]} is {km:.1f} km (> {MAX_KM:g} km)")
                break
            if cid not in checked:
                try:
                    checked[cid] = sample_check(cid, max(first, cc["HLY_FIRST_DATE"]), min(last, cc["HLY_LAST_DATE"]))
                except SystemExit as e:
                    checked[cid] = None
                    print(f"  pull FAILED for {cid}: {e}")
            if checked[cid] is None:
                notes.append(f"{cid} request failed")
                continue
            rows, found, yrs = checked[cid]
            if found == 0:
                notes.append(f"{cid} {cc['STATION_NAME'][:22]} {km:.1f} km: no PRECIP_AMOUNT in sampled Julys {yrs}")
                continue
            if cid not in pulled:
                try:
                    pulled[cid] = pull_hourly(cid, first, last)
                except SystemExit as e:
                    pulled[cid] = (None, [])
                    print(f"  pull FAILED for {cid}: {e}")
            s, cols = pulled[cid]
            if s is None:
                notes.append(f"{cid} full pull returned nothing")
                continue
            cov = coverage(s, first, last)
            if cov < 1 - MAX_MISSING:
                notes.append(f"{cid} {cc['STATION_NAME'][:22]} {km:.1f} km: {100 * (1 - cov):.0f}% hours missing")
                continue
            chosen = dict(climate_id=cid, name=cc["STATION_NAME"], km=round(km, 1), coverage=round(cov, 4))
            break
        if chosen:
            choice[st] = chosen
            print(f"  {st} {row['name'][:34]:<34} -> {chosen['climate_id']} {chosen['name'][:20]} {chosen['km']:5.1f} km, "
                  f"{100 * chosen['coverage']:.1f}% hours with PRECIP_AMOUNT over {first.date()}..{last.date()}")
        else:
            choice[st] = None
            print(f"  {st} {row['name'][:34]:<34} -> RATE: intensity features SKIPPED")
        for n in notes:
            print(f"      {n}")
    print("\n  Hourly stations used:")
    for cid, (s, cols) in pulled.items():
        if s is None:
            continue
        step = pd.Series(s.index).diff().mode().iloc[0]
        print(f"    {cid}: {s.index.min()} -> {s.index.max()}, {len(s)} rows, typical step {step}, "
              f"{100 * s.notna().mean():.1f}% PRECIP_AMOUNT non-missing overall")
        print(f"      columns: {cols}")
    (HOURLY_DIR / "choice.json").write_text(json.dumps(choice, indent=2))
    return choice


def hourly_series(cid):
    h = pd.read_csv(HOURLY_DIR / f"{cid}.csv", parse_dates=["LOCAL_DATE"])
    s = pd.Series(pd.to_numeric(h["PRECIP_AMOUNT"], errors="coerce").to_numpy(), index=h["LOCAL_DATE"])
    return s[~s.index.duplicated()].sort_index()


if __name__ == "__main__":
    choose_all()
