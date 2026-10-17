"""Step 1 (fleet): pick a climate station for each gauge and cache its daily precipitation.

For each gauge: ECCC climate stations (from the `climate-stations` collection, fetched with
flood_data.py's API helpers) are sorted by haversine distance from the gauge. Walking outward,
each candidate's daily record (`climate-daily`, the same call `flood_data.py rain` makes) is pulled
and cached in data/rain/{climate_id}.csv. The first station with >= 90% TOTAL_PRECIPITATION coverage
over the gauge's own data period (station_screen.csv first..last) is chosen.

Toronto Pearson is offered as one candidate, "6158731": its two climate IDs (6158733 to 2013-06,
6158731 after) are already combined in data/6158731_rain_daily.csv (src/fetch_rain.py).
A failed pull is reported and the next-nearest candidate is tried; nothing is retried around blocks.
"""
import contextlib
import io
import json
import sys

import numpy as np
import pandas as pd

from .config import DATA_DIR, RAIN_DIR, RAIN_FILE, ROOT
from .gauges import haversine_km, load_gauges

sys.path.insert(0, str(ROOT))
import flood_data as fd  # noqa: E402  (the project's own ECCC API helper)

MIN_COVERAGE = 0.90
WARN_KM = 25.0
BBOX = "-80.3,43.2,-78.6,44.3"
PEARSON_PARTS = {"6158731", "6158733"}


def _dms(v):
    """ECCC climate-stations encode lat/lon as DDMMSSsss integers (e.g. 434036000 = 43 deg 40' 36.000")."""
    s, v = np.sign(v), abs(int(v))
    return s * (v // 10_000_000 + (v // 100_000) % 100 / 60 + (v % 100_000) / 1000 / 3600)


def climate_stations() -> pd.DataFrame:
    RAIN_DIR.mkdir(parents=True, exist_ok=True)
    cache = RAIN_DIR / "climate_stations.csv"
    if cache.exists():
        return pd.read_csv(cache, dtype={"CLIMATE_IDENTIFIER": str})
    with contextlib.redirect_stderr(io.StringIO()):
        df = fd.fetch_items("climate-stations", {"bbox": BBOX}, page=1000, max_rows=5000)
    df = df[["STATION_NAME", "CLIMATE_IDENTIFIER", "LATITUDE", "LONGITUDE", "DLY_FIRST_DATE", "DLY_LAST_DATE"]].copy()
    df["lat"], df["lon"] = df["LATITUDE"].map(_dms), df["LONGITUDE"].map(_dms)
    df = df.dropna(subset=["DLY_FIRST_DATE", "DLY_LAST_DATE"])
    df.to_csv(cache, index=False)
    return df


def pull(climate_id: str):
    """Daily TOTAL_PRECIPITATION for one climate ID, cached. Returns a Series indexed by date, or None."""
    if climate_id == "6158731":
        r = pd.read_csv(DATA_DIR / RAIN_FILE)      # combined Pearson (6158733 + 6158731)
    else:
        cache = RAIN_DIR / f"{climate_id}.csv"
        if not cache.exists():
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    r = fd.fetch_items("climate-daily", {"CLIMATE_IDENTIFIER": climate_id,
                                                         "datetime": "2000-01-01/2025-12-31"}, page=2000)
            except SystemExit as e:
                print(f"      pull FAILED for {climate_id}: {e}")
                return None
            if r.empty:
                r = pd.DataFrame(columns=["LOCAL_DATE", "TOTAL_PRECIPITATION"])
            keep = [c for c in ("LOCAL_DATE", "STATION_NAME", "CLIMATE_IDENTIFIER", "TOTAL_PRECIPITATION",
                                "TOTAL_RAIN", "SNOW_ON_GROUND") if c in r]
            r[keep].to_csv(cache, index=False)
        r = pd.read_csv(cache)
    if r.empty:
        return pd.Series(dtype=float)
    s = pd.Series(pd.to_numeric(r["TOTAL_PRECIPITATION"], errors="coerce").to_numpy(),
                  index=pd.to_datetime(r["LOCAL_DATE"]).dt.normalize())
    return s[~s.index.duplicated()].sort_index()


def coverage(s: pd.Series, first, last) -> float:
    days = pd.date_range(first, last, freq="D")
    return float(s.reindex(days).notna().mean()) if len(s) else 0.0


def choose_all(stations=None) -> dict:
    g = load_gauges()
    if stations:
        g = g.loc[stations]
    cs = climate_stations()
    cs = cs[~cs["CLIMATE_IDENTIFIER"].isin(PEARSON_PARTS)].copy()
    pear = {"STATION_NAME": "TORONTO PEARSON (6158733 to 2013-06 + 6158731 after)", "CLIMATE_IDENTIFIER": "6158731",
            "lat": 43.677, "lon": -79.6306, "DLY_FIRST_DATE": "1937-11-01 00:00:00", "DLY_LAST_DATE": "2026-10-15 00:00:00"}
    cs = pd.concat([cs, pd.DataFrame([pear])], ignore_index=True)
    cs["DLY_FIRST_DATE"] = pd.to_datetime(cs["DLY_FIRST_DATE"])
    cs["DLY_LAST_DATE"] = pd.to_datetime(cs["DLY_LAST_DATE"])

    print("\n=== STEP 1 (fleet): nearest climate station with >= 90% precipitation coverage per gauge ===")
    choice, cache = {}, {}
    for st, row in g.iterrows():
        first, last = pd.Timestamp(row["first"]), pd.Timestamp(row["last"])
        c = cs[(cs["DLY_FIRST_DATE"] <= last) & (cs["DLY_LAST_DATE"] >= first)].copy()
        c["km"] = haversine_km(row["lat"], row["lon"], c["lat"].to_numpy(), c["lon"].to_numpy())
        c = c.sort_values("km")
        tried = []
        for _, cand in c.iterrows():
            cid = cand["CLIMATE_IDENTIFIER"]
            if cid not in cache:
                cache[cid] = pull(cid)
            s = cache[cid]
            if s is None:
                tried.append(f"{cid} pull failed")
                continue
            cov = coverage(s, first, last)
            if cov >= MIN_COVERAGE:
                choice[st] = dict(climate_id=cid, climate_name=cand["STATION_NAME"], km=round(float(cand["km"]), 1),
                                  coverage=round(cov, 4), first=str(first.date()), last=str(last.date()))
                warn = "  !!! WARNING: more than 25 km away !!!" if cand["km"] > WARN_KM else ""
                print(f"  {st} {row['name'][:38]:<38} -> {cid} {cand['STATION_NAME'][:40]:<40} "
                      f"{cand['km']:5.1f} km, coverage {100 * cov:.1f}% ({first.date()}..{last.date()}){warn}")
                if tried:
                    print(f"      skipped nearer: {'; '.join(tried)}")
                break
            tried.append(f"{cid} {cand['STATION_NAME'][:24]} {cand['km']:.1f} km {100 * cov:.0f}%")
        else:
            print(f"  {st}: NO climate station reached {100 * MIN_COVERAGE:.0f}% coverage. Tried: {'; '.join(tried)}")
    (RAIN_DIR / "choice.json").write_text(json.dumps(choice, indent=2))
    return choice


def rain_frame(climate_id: str) -> pd.DataFrame:
    s = pull(climate_id)
    return s.rename("TOTAL_PRECIPITATION").to_frame()


if __name__ == "__main__":
    choose_all()
