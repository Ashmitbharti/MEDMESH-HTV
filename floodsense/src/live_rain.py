"""Recent rain for live prediction: last ~20 days of daily rain (climate-daily) and of hourly rain
(climate-hourly) for a gauge's chosen climate stations, cached in data/rain_live/.

offline=True never touches the network and uses the cache only. A failed request is reported and the cache
(if any) is used; nothing is retried around blocks. Missing values stay NaN and are imputed by the model's
train-fitted imputer, which the caller reports.
"""
import contextlib
import io
import sys

import pandas as pd

from .config import DATA_DIR, ROOT

sys.path.insert(0, str(ROOT))
import flood_data as fd  # noqa: E402

LIVE_DIR = DATA_DIR / "rain_live"


def _fetch(collection, cid, start, end):
    with contextlib.redirect_stderr(io.StringIO()):
        return fd.fetch_items(collection, {"CLIMATE_IDENTIFIER": cid, "datetime": f"{start}/{end}"},
                              page=1000, max_rows=20000)


def recent(kind, cid, end_day, days=20, offline=False):
    """kind: 'daily' or 'hourly'. Returns (Series or None, status text)."""
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    cache = LIVE_DIR / f"{cid}_{kind}.csv"
    status = "cache"
    if not offline:
        start = (pd.Timestamp(end_day) - pd.Timedelta(days=days)).date()
        end = (pd.Timestamp(end_day) + pd.Timedelta(days=1)).date()
        try:
            d = _fetch("climate-daily" if kind == "daily" else "climate-hourly", cid, start, end)
            col = "TOTAL_PRECIPITATION" if kind == "daily" else "PRECIP_AMOUNT"
            if not d.empty:
                d[["LOCAL_DATE", col]].rename(columns={col: "P"}).to_csv(cache, index=False)
                status = "live"
            else:
                status = "live request returned no rows"
        except SystemExit as e:
            status = f"live request FAILED ({e}); using cache"
    if not cache.exists():
        return None, status + " (no cache)"
    c = pd.read_csv(cache, parse_dates=["LOCAL_DATE"])
    s = pd.Series(pd.to_numeric(c["P"], errors="coerce").to_numpy(), index=c["LOCAL_DATE"])
    if kind == "daily":
        s.index = s.index.normalize()
    return s[~s.index.duplicated()].sort_index(), status
