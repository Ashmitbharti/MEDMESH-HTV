"""Shared constants, log reading, features and labels for Model A (mesh link health).

One code path builds features for training rows, the leakage test and live scoring:
`node_features_at` only ever looks at packets with timestamp <= t.
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
RESULTS_DIR = ROOT / "results"
MODELS_DIR = ROOT / "models"

RANDOM_STATE = 42

WINDOW_STEP = 10        # one row per 10 s window
WARMUP = 30             # a node must have been heard for 30 s before it gets rows
SILENCE_FAIL = 90       # silence of >= 90 s = failure
HORIZON = 120           # label: failure starts within 120 s

# collect_min.py column order
LOG_COLS = ["ts_utc", "from_id", "to_id", "packet_id", "portnum", "rx_snr", "rx_rssi",
            "hop_limit", "hop_start", "hops_used", "battery_level", "voltage",
            "channel_utilization", "air_util_tx", "rx_time"]

NUMERIC = ["snr_mean_30s", "snr_slope_30s", "snr_std_30s", "rssi_mean_30s", "rssi_slope_30s",
           "packets_per_min", "hops_used", "hops_change_120s", "seconds_since_last_packet",
           "battery_voltage", "voltage_slope", "channel_utilization"]
FLAGS = ["snr_missing", "snr_slope_missing", "hops_missing", "voltage_missing", "chutil_missing"]
FEATURES = NUMERIC + FLAGS
# kept in the dataset but never used as model inputs
AUX = ["snr_max_30s", "time_to_failure_s"]
ID_COLS = ["scenario", "session_id", "node_id", "t_seconds"]
LABEL = f"label_fail_within_{HORIZON}s"

FAILURE_SCENARIOS = ["walkout", "obstruction", "stepwise_fade", "water", "hard_unplug", "relay_failure",
                     "brownout"]
HARD_NEGATIVES = ["short_dip", "interference_burst", "walk_away_back"]
SCENARIOS = FAILURE_SCENARIOS + HARD_NEGATIVES + ["baseline"]


def read_log(path) -> pd.DataFrame:
    """A collect_min.py packet CSV -> DataFrame with `t` = seconds since the Unix epoch (float)."""
    df = pd.read_csv(path, dtype={"from_id": str, "to_id": str})
    return prepare_log(df)


def prepare_log(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    ts = pd.to_datetime(df["ts_utc"], utc=True, format="ISO8601")
    df["t"] = (ts - pd.Timestamp(0, tz="UTC")).dt.total_seconds()
    for c in ("rx_snr", "rx_rssi", "hops_used", "voltage", "channel_utilization"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.sort_values("t", kind="stable").reset_index(drop=True)


def node_arrays(log: pd.DataFrame, node_id: str) -> dict:
    d = log[log["from_id"] == node_id]
    return {k: d[c].to_numpy(dtype=float) for k, c in
            (("ts", "t"), ("snr", "rx_snr"), ("rssi", "rx_rssi"), ("hops", "hops_used"),
             ("volt", "voltage"), ("cu", "channel_utilization"))}


def _slope(x, y, min_pts):
    ok = ~np.isnan(y)
    x, y = x[ok], y[ok]
    if len(x) < min_pts or np.ptp(x) == 0:
        return np.nan
    return float(np.polyfit(x - x[0], y, 1)[0])


def _last_valid(ts, v, i_end, t, max_age):
    """Last non-missing value among packets [0, i_end) no older than max_age seconds."""
    for i in range(i_end - 1, -1, -1):
        if t - ts[i] > max_age:
            break
        if not np.isnan(v[i]):
            return v[i]
    return np.nan


def node_features_at(a: dict, t: float) -> dict:
    """Features for one node at window end t from packets with timestamp <= t only."""
    ts = a["ts"]
    end = int(np.searchsorted(ts, t, side="right"))     # packets [0, end) have ts <= t
    s30 = int(np.searchsorted(ts, t - 30, side="right"))
    s60 = int(np.searchsorted(ts, t - 60, side="right"))
    s120 = int(np.searchsorted(ts, t - 120, side="right"))
    w = slice(s30, end)
    snr, rssi, tw = a["snr"][w], a["rssi"][w], ts[w]
    has_snr = bool((~np.isnan(snr)).any())
    f = {
        "snr_mean_30s": float(np.nanmean(snr)) if has_snr else np.nan,
        "snr_std_30s": float(np.nanstd(snr)) if has_snr else np.nan,
        "snr_max_30s": float(np.nanmax(snr)) if has_snr else np.nan,
        "snr_slope_30s": _slope(tw, snr, 3),
        "rssi_mean_30s": float(np.nanmean(rssi)) if (~np.isnan(rssi)).any() else np.nan,
        "rssi_slope_30s": _slope(tw, rssi, 3),
        "packets_per_min": float(end - s60),
        "seconds_since_last_packet": float(t - ts[end - 1]) if end else np.nan,
    }
    hops_now = _last_valid(ts, a["hops"], end, t, 600)
    h120 = a["hops"][s120:end]
    h120 = h120[~np.isnan(h120)]
    f["hops_used"] = hops_now
    f["hops_change_120s"] = float(hops_now - h120[0]) if len(h120) and not np.isnan(hops_now) else np.nan
    f["battery_voltage"] = _last_valid(ts, a["volt"], end, t, 300)
    vs = _slope(ts[s120:end], a["volt"][s120:end], 2)
    f["voltage_slope"] = vs * 60 if not np.isnan(vs) else np.nan          # V per minute
    f["channel_utilization"] = _last_valid(ts, a["cu"], end, t, 300)
    f["snr_missing"] = float(not has_snr)
    f["snr_slope_missing"] = float(np.isnan(f["snr_slope_30s"]))
    f["hops_missing"] = float(np.isnan(hops_now))
    f["voltage_missing"] = float(np.isnan(f["battery_voltage"]))
    f["chutil_missing"] = float(np.isnan(f["channel_utilization"]))
    return f


def failures(ts: np.ndarray, log_end: float):
    """Failure = a silence of >= SILENCE_FAIL s. Returns [(start, recovery)], start = last packet before the
    silence, recovery = next packet (inf if the log ends first)."""
    out = []
    for i in range(len(ts)):
        nxt = ts[i + 1] if i + 1 < len(ts) else log_end
        if nxt - ts[i] >= SILENCE_FAIL:
            out.append((ts[i], ts[i + 1] if i + 1 < len(ts) else np.inf))
    return out


def label_at(t: float, fails, log_end: float):
    """(label, time_to_failure) for a row at t, or None if the row is excluded:
    - node already failing (t at/after a failure start and before recovery), or
    - no failure found after t and the log ends too soon to rule one out (censored)."""
    for s, r in fails:
        if s <= t < r:
            return None
    nxt = [s for s, _ in fails if s > t]
    if nxt:
        ttf = min(nxt) - t
        return int(ttf <= HORIZON), ttf
    if t + HORIZON + SILENCE_FAIL <= log_end:
        return 0, np.nan
    return None


def window_times(first_heard: float, log_start: float, log_end: float):
    t = log_start + np.ceil((first_heard + WARMUP - log_start) / WINDOW_STEP) * WINDOW_STEP
    return np.arange(t, log_end + 1e-9, WINDOW_STEP)
