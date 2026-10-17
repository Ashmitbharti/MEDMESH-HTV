"""Combiner tests (run: python -m pytest tests -q)."""
import math

import numpy as np
import pandas as pd
import pytest

from src.combine import combine, combine_values, weights
from src.gauges import haversine_km

TH = {
    "A": {"lat": 43.778, "lon": -79.191, "watch": 0.10, "warning": 0.40},   # ~Highland Creek
    "B": {"lat": 43.753, "lon": -79.234, "watch": 0.20, "warning": 0.50},   # ~West Highland, 4.4 km from A
    "C": {"lat": 43.647, "lon": -79.520, "watch": 0.15, "warning": 0.45},   # ~Mimico, ~30 km from A
}
NOW = pd.Timestamp("2026-10-17T12:00:00Z")


def readings(pa, pb, pc, t="2026-10-17T11:00:00Z"):
    return {"A": {"p": pa, "time": t}, "B": {"p": pb, "time": t}, "C": {"p": pc, "time": t}}


def test_relay_at_gauge_returns_that_gauges_risk_when_it_is_the_highest():
    out = combine(TH["A"]["lat"], TH["A"]["lon"], readings(0.7, 0.2, 0.1), TH, R=15, now=NOW)
    assert out["nearest_gauge"] == "A"
    assert out["combined_risk"] == pytest.approx(0.7)          # near = 0.7 >= weighted avg
    assert out["alert"] == "WARNING"                           # A's thresholds


def test_relay_at_gauge_with_riskier_neighbour_is_not_below_own_risk():
    # By design combined = max(near, weighted_avg): a riskier neighbour can only raise it.
    out = combine(TH["A"]["lat"], TH["A"]["lon"], readings(0.1, 0.9, 0.0), TH, R=15, now=NOW)
    assert out["near"] == pytest.approx(0.1)
    assert out["combined_risk"] >= 0.1
    d_ab = float(haversine_km(TH["A"]["lat"], TH["A"]["lon"], TH["B"]["lat"], TH["B"]["lon"]))
    w = np.array([1.0, 1 / d_ab ** 2])
    assert out["combined_risk"] == pytest.approx(round((0.1 * w[0] + 0.9 * w[1]) / w.sum(), 4))


def test_relay_beyond_R_returns_null():
    out = combine(44.5, -79.0, readings(0.9, 0.9, 0.9), TH, R=15, now=NOW)   # ~80 km north
    assert out["combined_risk"] is None
    assert out["message"] == "no gauge nearby"
    assert out["gauges_used"] == []


def test_far_gauge_ignored_and_weights_inverse_square_with_1km_floor():
    out = combine(TH["A"]["lat"], TH["A"]["lon"], readings(0.3, 0.3, 0.99), TH, R=15, now=NOW)
    assert [g["station"] for g in out["gauges_used"]] == ["A", "B"]          # C is ~30 km away
    assert weights([0.0, 0.5, 2.0]).tolist() == [1.0, 1.0, 0.25]


def test_stale_flag_and_unavailable_gauge():
    r = readings(0.3, None, 0.1, t="2026-10-17T07:00:00Z")                  # 5 h old
    out = combine(TH["A"]["lat"], TH["A"]["lon"], r, TH, R=15, now=NOW)
    assert out["stale"] is True
    assert "B" in out["unavailable_gauges"]
    fresh = combine(TH["A"]["lat"], TH["A"]["lon"], readings(0.3, 0.2, 0.1), TH, R=15, now=NOW)
    assert fresh["stale"] is False


def test_combine_values_formula():
    c, wavg, near, w = combine_values([2.0, 4.0], [0.2, 0.6])
    assert near == 0.2
    assert wavg == pytest.approx((0.2 / 4 + 0.6 / 16) / (1 / 4 + 1 / 16))
    assert c == pytest.approx(max(near, wavg))
    assert math.isclose(sum(w), 0.25 + 0.0625)


def test_unusable_gauge_is_skipped():
    th = {k: dict(v) for k, v in TH.items()}
    th["A"]["usable"] = False
    out = combine(TH["A"]["lat"], TH["A"]["lon"], readings(0.9, 0.2, 0.1), th, R=15, now=NOW)
    assert [e["station"] for e in out["excluded_unusable_gauges"]] == ["A"]
    assert out["nearest_gauge"] == "B"
