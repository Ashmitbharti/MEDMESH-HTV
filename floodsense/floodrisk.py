"""FloodSense Model B: flood risk at a location, for the MedMesh FastAPI command centre.

    from floodrisk import risk_at
    risk_at(43.775, -79.257)                 # uses results/latest_readings.json (from predict_all.py)
    risk_at(43.775, -79.257, refresh=True)   # recompute every gauge's probability now (fetches rain)

Returns the combiner JSON: combined_risk (null if no usable gauge within R), alert (NONE/WATCH/WARNING from
the nearest gauge's validation thresholds), gauges_used (distance, weight, p, reading time), driven_by,
timestamp, stale (any used reading older than 3 h) and the gauges excluded or unavailable.

The risk is a creek high-water proxy for TOMORROW (gauge daily mean above its train p95), estimated between
gauges by inverse-square distance weighting. It is not a street-level flood prediction.
"""
import json
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.combine import DEFAULT_R, combine  # noqa: E402
from src.config import MODELS_DIR, RESULTS_DIR  # noqa: E402

warnings.filterwarnings("ignore", category=UserWarning)


def _thresholds():
    return json.loads((MODELS_DIR / "thresholds.json").read_text())


def latest_readings(refresh=False, offline=False, path=None):
    """Gauge probabilities: read from predict_all.py's JSON, or recompute now (refresh=True)."""
    if not refresh:
        p = Path(path) if path else RESULTS_DIR / "latest_readings.json"
        if not p.exists():
            raise FileNotFoundError(f"{p} not found: run `python predict_all.py` or call risk_at(..., refresh=True)")
        return json.loads(p.read_text())
    from src.clean import realtime_path
    from src.live import predict_gauge
    out = {}
    for st, th in _thresholds().items():
        if not th.get("usable", True) or not realtime_path(st).exists():
            out[st] = {"p": None, "time": None}
            continue
        try:
            r = predict_gauge(st, offline=offline)
            out[st] = {"p": r["p"], "time": r["time"], "level": r["level"]}
        except ValueError:
            out[st] = {"p": None, "time": None}
    return out


def risk_at(lat: float, lon: float, R: float = DEFAULT_R, refresh: bool = False, offline: bool = False,
            readings_path=None) -> dict:
    """Combined creek high-water risk (next 24 h) at a relay location. JSON-serialisable dict."""
    res = combine(float(lat), float(lon), latest_readings(refresh, offline, readings_path), _thresholds(), R)
    res["timestamp"] = res.get("evaluated_at")
    res["model"] = "FloodSense Model B"
    return res


if __name__ == "__main__":
    lat, lon = (float(sys.argv[1]), float(sys.argv[2])) if len(sys.argv) > 2 else (43.775, -79.257)
    print(json.dumps(risk_at(lat, lon), indent=2))
