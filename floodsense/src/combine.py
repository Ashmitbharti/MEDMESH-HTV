"""Distance-weighted combiner: gauge probabilities -> risk at a relay location.

  w_i           = 1 / max(d_i, 1 km)^2        (haversine distance, gauges farther than R km ignored)
  weighted_avg  = sum(w_i p_i) / sum(w_i)
  near          = p of the single nearest gauge within R
  combined_risk = max(near, weighted_avg)
No gauge within R -> combined_risk = null, "no gauge nearby" (no extrapolation).
Gauges flagged usable=false in models/thresholds.json (too few validation/test events) are skipped.
Alert level uses the WATCH/WARNING cut-offs of the nearest gauge. stale = any used reading > 3 h old.

Usage (any of these, from any folder):
  python predict_all.py                                   # writes results/latest_readings.json
  python -m src.combine --lat 43.775 --lon -79.257        # from floodsense/; Scarborough Centre
  python src/combine.py --lat 43.775 --lon -79.257 --R 10 # from floodsense/
  python combine.py --lat 43.775 --lon -79.257            # from floodsense/src/
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

if __package__ in (None, ""):
    # Run as a plain script (python combine.py): make the project root importable so `src` resolves.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from src.config import MODELS_DIR, RESULTS_DIR
    from src.gauges import haversine_km
else:
    from .config import MODELS_DIR, RESULTS_DIR
    from .gauges import haversine_km

DEFAULT_R = 15.0
STALE_HOURS = 3.0


def alert_level(p, watch, warning):
    return "WARNING" if p >= warning else ("WATCH" if p >= watch else "NONE")


def weights(dist_km):
    return 1.0 / np.maximum(np.asarray(dist_km, float), 1.0) ** 2


def combine_values(dist_km, probs):
    """Pure formula. dist_km / probs: 1-D arrays of the gauges within R. Returns (combined, wavg, near, w)."""
    d, p = np.asarray(dist_km, float), np.asarray(probs, float)
    w = weights(d)
    wavg = float(np.sum(w * p) / np.sum(w))
    near = float(p[np.argmin(d)])
    return max(near, wavg), wavg, near, w


def combine(lat, lon, readings: dict, thresholds: dict, R=DEFAULT_R, now=None, stale_hours=STALE_HOURS) -> dict:
    """readings: {station: {"p": float or None, "time": ISO-8601 UTC or None}}; thresholds: models/thresholds.json."""
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    cand, unavailable, excluded = [], [], []
    for st, r in readings.items():
        if st not in thresholds:
            continue
        if thresholds[st].get("usable", True) is False:
            excluded.append({"station": st, "reason": thresholds[st].get("usable_reason", "usable=false")})
            continue
        if r.get("p") is None or (isinstance(r.get("p"), float) and np.isnan(r["p"])):
            unavailable.append(st)
            continue
        d = float(haversine_km(lat, lon, thresholds[st]["lat"], thresholds[st]["lon"]))
        if d <= R:
            cand.append((st, d, float(r["p"]), r.get("time"), bool(r.get("simulated", False))))
    out = {"relay": {"lat": lat, "lon": lon}, "radius_km": R, "unavailable_gauges": unavailable,
           "excluded_unusable_gauges": excluded}
    if not cand:
        return {**out, "combined_risk": None, "alert": None, "message": "no gauge nearby", "gauges_used": [],
                "stale": None, "evaluated_at": now.isoformat()}
    sts, d, p, times, sim = zip(*cand)
    combined, wavg, near, w = combine_values(d, p)
    i_near = int(np.argmin(d))
    th = thresholds[sts[i_near]]
    alert = alert_level(combined, th["watch"], th["warning"])
    wp = np.asarray(w) * np.asarray(p)
    contrib = wp / wp.sum() if wp.sum() > 0 else np.zeros(len(wp))
    ages = []
    for t in times:
        ages.append(np.inf if t is None else (now - pd.Timestamp(t)).total_seconds() / 3600)
    used = [{"station": s, "distance_km": round(dd, 2), "weight": round(float(ww), 5),
             "weight_share": round(float(ww / sum(w)), 4), "p": round(pp, 4),
             "share_of_weighted_avg": round(float(cc), 4), "simulated": ss, "reading_time": t,
             "age_hours": None if np.isinf(a) else round(a, 2)}
            for s, dd, ww, pp, cc, ss, t, a in zip(sts, d, w, p, contrib, sim, times, ages)]
    driver = (f"near: nearest gauge {sts[i_near]} (p={near:.3f} >= weighted avg {wavg:.3f})" if near >= wavg
              else f"weighted_avg ({wavg:.3f} > nearest {sts[i_near]} p={near:.3f}); largest share "
                   f"{sts[int(np.argmax(contrib))]} ({100 * contrib.max():.0f}%)")
    return {**out, "combined_risk": round(combined, 4), "weighted_avg": round(wavg, 4), "near": round(near, 4),
            "nearest_gauge": sts[i_near], "alert": alert, "driven_by": driver,
            "simulated_gauges": [s for s, ss in zip(sts, sim) if ss],
            "alert_thresholds": {"from": sts[i_near], "watch": th["watch"], "warning": th["warning"]},
            "gauges_used": sorted(used, key=lambda u: u["distance_km"]),
            "oldest_reading": min((t for t in times if t), default=None),
            "stale": bool(max(ages) > stale_hours), "stale_rule_hours": stale_hours,
            "evaluated_at": now.isoformat()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--R", type=float, default=DEFAULT_R)
    ap.add_argument("--readings", default=str(RESULTS_DIR / "latest_readings.json"))
    ap.add_argument("--simulate", nargs="*", default=None, metavar="STATION=PCT",
                    help="what-if: recompute these gauges with level+discharge at a training percentile "
                         "(in memory only; the readings file is not modified)")
    a = ap.parse_args()
    readings = json.loads(open(a.readings).read())
    thresholds = json.loads((MODELS_DIR / "thresholds.json").read_text())
    if a.simulate:
        from src.live import parse_simulate, predict_gauge   # heavier imports only when simulating
        readings = {k: dict(v) for k, v in readings.items()}   # work on a copy
        for st, pct in parse_simulate(a.simulate).items():
            res = predict_gauge(st, simulate_pct=pct)
            readings[st] = {"p": res["p"], "time": res["time"], "simulated": True, "simulation": res["simulation"]}
            s = res["simulation"]
            print(f"# SIMULATED {st}: level {s['level']:.3f} m, discharge {s['discharge']:.3f} m3/s "
                  f"(train p{pct:g}; real latest day {res['info']['real_level_mean']:.3f} m) -> p={res['p']:.4f} "
                  f"({res['level']} at the gauge)")
    print(json.dumps(combine(a.lat, a.lon, readings, thresholds, a.R), indent=2))


if __name__ == "__main__":
    main()
