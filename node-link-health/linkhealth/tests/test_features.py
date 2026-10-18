"""Leakage and label tests (run: python -m pytest tests -q)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from build_dataset import build_session  # noqa: E402
from common import (FEATURES, HORIZON, LABEL, failures, label_at, node_arrays, node_features_at,  # noqa: E402
                    prepare_log, read_log)
from simulate import T0_BASE, make_episode, make_node, simulate_node, to_log  # noqa: E402

FEATS = FEATURES + ["snr_max_30s"]


def session_log(sc="walkout", seed=3):
    rng = np.random.default_rng(seed)
    node = make_node(rng, "!0000aaaa")
    ep = make_episode(sc, rng, node, 0.0)
    return prepare_log(to_log(simulate_node(node, [ep], ep["end"], rng), T0_BASE, rng)), node["id"]


def scramble_after(log, t_cut, seed=1):
    """Change every packet after t_cut, drop a third of them and add new ones."""
    rng = np.random.default_rng(seed)
    out = log.copy()
    out[["rx_snr", "rx_rssi", "voltage", "hops_used", "channel_utilization"]] = out[
        ["rx_snr", "rx_rssi", "voltage", "hops_used", "channel_utilization"]].astype(float)
    late = out["t"] > t_cut
    out.loc[late, "rx_snr"] = rng.normal(-20, 5, late.sum())
    out.loc[late, "rx_rssi"] = rng.normal(-130, 5, late.sum())
    out.loc[late, "voltage"] = rng.normal(3.0, 0.2, late.sum())
    out.loc[late, "hops_used"] = 3
    out.loc[late, "channel_utilization"] = 90.0
    out = out.drop(out[late].sample(frac=1 / 3, random_state=0).index)
    extra = out[out["t"] > t_cut].head(5).copy()
    extra["t"] += 0.5
    return pd.concat([out, extra]).sort_values("t", kind="stable").reset_index(drop=True)


@pytest.mark.parametrize("sc", ["walkout", "water", "brownout", "relay_failure", "interference_burst"])
@pytest.mark.parametrize("frac", [0.2, 0.5, 0.8])
def test_features_at_t_ignore_later_packets(sc, frac):
    log, nid = session_log(sc)
    t_min, t_max = log["t"].min(), log["t"].max()
    t_cut = t_min + frac * (t_max - t_min)
    a, b = node_arrays(log, nid), node_arrays(scramble_after(log, t_cut), nid)
    checked = 0
    for t in np.arange(t_min + 30, t_cut + 1e-9, 10):
        fa, fb = node_features_at(a, t), node_features_at(b, t)
        for k in FEATS:
            assert (np.isnan(fa[k]) and np.isnan(fb[k])) or fa[k] == fb[k], (sc, t, k, fa[k], fb[k])
        checked += 1
    assert checked > 0


def test_dataset_rows_before_cut_ignore_later_packets(tmp_path):
    """Same check through the full raw-log -> dataset path (labels may change: they are allowed to look ahead)."""
    src = sorted(Path(__file__).resolve().parent.parent.glob("data/raw/synth_cov_brownout_0*.csv"))
    src = [p for p in src if not p.name.endswith("_events.csv")]
    if not src:
        pytest.skip("run make_coverage_data.py first")
    raw = pd.read_csv(src[0])
    log = read_log(src[0])
    t_cut = log["t"].quantile(0.6)
    alt = scramble_after(log, t_cut)
    alt_raw = alt.drop(columns="t")
    (tmp_path / "a.csv").write_text(raw.to_csv(index=False))
    (tmp_path / "b.csv").write_text(alt_raw.to_csv(index=False))
    da, db = build_session(tmp_path / "a.csv"), build_session(tmp_path / "b.csv")
    t0 = log["t"].min()
    key = ["node_id", "t_seconds"]
    m = da.merge(db, on=key, suffixes=("_a", "_b"))
    m = m[m.t_seconds + t0 <= t_cut]
    assert len(m) > 5
    for k in FEATS:
        pd.testing.assert_series_equal(m[k + "_a"], m[k + "_b"], check_names=False)


def test_silence_of_90s_is_a_failure_and_label_looks_horizon_ahead():
    ts = np.array([0, 5, 10, 15, 20, 120, 125, 130.0])       # 100 s gap after t=20
    fails = failures(ts, log_end=400)
    assert fails == [(20, 120), (130, np.inf)]
    assert label_at(0, fails, 400) == (1, 20)
    assert label_at(20, fails, 400) is None                 # already silent
    assert label_at(160, [(300.0, np.inf)], 600) == (0, 140.0)    # 140 s ahead: beyond the 120 s horizon
    assert label_at(190, [(300.0, np.inf)], 600) == (1, 110.0)
    assert label_at(60, fails, 400) is None
    y, ttf = label_at(125, fails, 400)
    assert (y, ttf) == (1, 5)
    short = failures(np.array([0, 50, 100.0]), log_end=150)  # 50 s gaps: not a failure; tail 50 s: unknown
    assert short == []
    assert label_at(40, short, 150) is None                 # censored: can't rule out a failure
