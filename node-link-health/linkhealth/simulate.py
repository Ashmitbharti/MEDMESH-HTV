"""Packet-stream simulator for the link-health scenarios. Everything here is SIMULATED.

Physical model (assumptions, not measurements):
- each node tries to send a packet every 3-7 s; ~25% of them are telemetry (voltage, channel utilisation)
- a packet is received with probability sigmoid((SNR_observed - FLOOR) / 1.2), FLOOR = -15 dB (LoRa long-range
  presets demodulate down to roughly -15..-20 dB), times a scenario loss factor (collisions, route discovery)
- RSSI = noise floor (-118 dBm, raised during interference) + SNR + noise
- rx_snr is rounded to 0.25 dB like Meshtastic reports it
A scenario is a function of time since the episode start; sessions differ by random base SNR, channel use,
battery level, hop count and timing.
"""
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from common import FAILURE_SCENARIOS, LOG_COLS

FLOOR = -15.0
NOISE_FLOOR = -118.0
T0_BASE = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc).timestamp()


def _u(rng, a, b):
    return float(rng.uniform(a, b))


def make_node(rng, node_id, hops=None):
    return dict(id=node_id, b=_u(rng, 0, 10), cu=_u(rng, 2, 25),
                hops=int(rng.choice([0, 0, 1])) if hops is None else hops)


def make_episode(sc, rng, node, start):
    """Parameters and length of one scenario episode for one node, starting at `start` (s, session time)."""
    b, F = node["b"], FLOOR
    # failures get a long stable lead-in so their sessions also contain early (negative) rows
    te = _u(rng, 200, 320) if sc in FAILURE_SCENARIOS else _u(rng, 60, 150)
    hold = _u(rng, 100, 160)          # silence after a failure (>= 90 s, so it counts as a failure)
    tail = _u(rng, 280, 320)          # quiet time after a hard negative, so its rows can be labelled
    p = dict(scenario=sc, start=start, te=te, v0=_u(rng, 3.85, 4.15))
    if sc == "baseline":
        p.update(L=_u(rng, 380, 450), event=None)
    elif sc == "walkout":
        p.update(D=_u(rng, 75, 105), drop=b - F + 6)
        p.update(L=te + p["D"] + hold, event=(te, te + p["D"]))
    elif sc == "obstruction":
        p.update(D=_u(rng, 6, 20), drop=b - F + _u(rng, 8, 14))
        p.update(L=te + p["D"] + hold, event=(te, te + p["D"]))
    elif sc == "stepwise_fade":
        p.update(step_db=_u(rng, 3, 5), step_s=_u(rng, 35, 60))
        n = int(np.ceil((b - F + 6) / p["step_db"]))
        p.update(L=te + n * p["step_s"] + hold, event=(te, te + n * p["step_s"]))
    elif sc == "water":
        p.update(D=_u(rng, 120, 200), drop=b - F + 6)
        p.update(L=te + p["D"] + hold, event=(te, te + p["D"]))
    elif sc == "hard_unplug":
        p.update(L=te + hold, event=(te, te))
    elif sc == "relay_failure":
        p.update(alt_snr=F + _u(rng, 2, 4), alt_decay=_u(rng, 0.05, 0.09))
        p.update(L=te + 140 + hold, event=(te, te + 140))
    elif sc == "brownout":
        p.update(D=_u(rng, 120, 220))
        p.update(L=te + p["D"] + hold, event=(te, te + p["D"]))
    elif sc == "short_dip":
        p.update(drop=_u(rng, 10, 16), H=_u(rng, 6, 22))
        p.update(L=te + 30 + tail, event=(te, te + p["H"] + 6))
    elif sc == "interference_burst":
        p.update(dur=_u(rng, 30, 60), cu_hi=_u(rng, 40, 65), noise_up=_u(rng, 6, 10))
        p.update(L=te + p["dur"] + tail, event=(te, te + p["dur"]))
    elif sc == "walk_away_back":
        p.update(drop=min(_u(rng, 8, 14), b - (F + 6)), D1=_u(rng, 40, 70), H=_u(rng, 15, 35), D2=_u(rng, 40, 70))
        p.update(L=te + p["D1"] + p["H"] + p["D2"] + tail, event=(te, te + p["D1"] + p["H"] + p["D2"]))
    else:
        raise ValueError(sc)
    p["end"] = start + p["L"]
    return p


def state(ep, node, tau):
    """Link state of `node` at `tau` seconds into episode `ep`."""
    sc, te, b, F = ep["scenario"], ep["te"], node["b"], FLOOR
    s = dict(tx=True, snr=b, sd=1.0, hops=node["hops"], cu=node["cu"], loss=1.0, noise_up=0.0,
             volt=ep["v0"] - 2e-5 * tau)
    d = tau - te
    if sc == "baseline" or d < 0:
        if sc == "relay_failure":
            s["hops"] = 1
        return s
    if sc == "walkout":
        s["snr"] = max(b - ep["drop"] * d / ep["D"], F - 25)
    elif sc == "obstruction":
        s["snr"] = b - ep["drop"] * min(1.0, d / ep["D"])
    elif sc == "stepwise_fade":
        s["snr"] = max(b - (np.floor(d / ep["step_s"]) + 1) * ep["step_db"], F - 25)
    elif sc == "water":
        s["snr"] = max(b - ep["drop"] * d / ep["D"], F - 25)
        s["sd"] = 1.0 + 2.5 * min(1.0, d / 40)
    elif sc == "hard_unplug":
        s["tx"] = False
    elif sc == "relay_failure":     # relay unplugged: only a weak 2-hop alternative path, fading out
        s.update(hops=2, snr=ep["alt_snr"] - ep["alt_decay"] * d, sd=2.5, loss=0.7)
    elif sc == "brownout":
        v = ep["v0"] - (ep["v0"] - 3.25) * min(1.0, d / ep["D"])
        s["volt"] = v
        s["snr"] = b - 4 * float(np.clip((3.55 - v) / 0.25, 0, 1))
        s["tx"] = v > 3.30
    elif sc == "short_dip":
        H = ep["H"]
        k = d / 3 if d < 3 else 1.0 if d < 3 + H else max(0.0, 1 - (d - 3 - H) / 3)
        s["snr"] = b - ep["drop"] * k
    elif sc == "interference_burst":
        if d < ep["dur"]:
            s.update(cu=ep["cu_hi"], noise_up=ep["noise_up"], snr=b - ep["noise_up"], sd=2.0,
                     loss=1 - 0.5 * ep["cu_hi"] / 100)
    elif sc == "walk_away_back":
        D1, H, D2 = ep["D1"], ep["H"], ep["D2"]
        k = d / D1 if d < D1 else 1.0 if d < D1 + H else max(0.0, 1 - (d - D1 - H) / D2)
        s["snr"] = b - ep["drop"] * k
    return s


def simulate_node(node, episodes, T, rng, off_windows=()):
    """Packets received from `node` over [0, T). `off_windows`: extra (start, end) ranges with the node off
    (used for a relay that someone unplugs)."""
    pk, t = [], _u(rng, 0, 5)
    while t < T:
        ep = next((e for e in episodes if e["start"] <= t < e["end"]), episodes[-1])
        s = state(ep, node, t - ep["start"])
        if any(a <= t < b for a, b in off_windows):
            s["tx"] = False
        if s["tx"]:
            snr = s["snr"] + rng.normal(0, s["sd"])
            p = 1 / (1 + np.exp(-(snr - FLOOR) / 1.2)) * s["loss"]
            if rng.random() < p:
                tele = rng.random() < 0.25
                v = s["volt"] + rng.normal(0, 0.008)
                pk.append(dict(t=t, from_id=node["id"], snr=round(snr * 4) / 4,
                               rssi=int(round(max(NOISE_FLOOR + s["noise_up"] + snr + rng.normal(0, 1.5), -140))),
                               hops=s["hops"], tele=tele, volt=round(v, 3),
                               batt=int(np.clip(round((v - 3.3) / 0.9 * 100), 0, 100)),
                               cu=round(max(0.0, s["cu"] + rng.normal(0, 1.0)), 2),
                               air=round(_u(rng, 0.5, 3), 2)))
        t += _u(rng, 3, 7)
    return pk


def to_log(packets, t0, rng) -> pd.DataFrame:
    rows = []
    for p in sorted(packets, key=lambda p: p["t"]):
        ts = t0 + p["t"]
        tele = p["tele"]
        rows.append({
            "ts_utc": datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="milliseconds"),
            "from_id": p["from_id"], "to_id": "^all", "packet_id": int(rng.integers(1, 2**31)),
            "portnum": "TELEMETRY_APP" if tele else str(rng.choice(["POSITION_APP", "TEXT_MESSAGE_APP",
                                                                    "NODEINFO_APP"])),
            "rx_snr": p["snr"], "rx_rssi": p["rssi"], "hop_limit": 3 - p["hops"], "hop_start": 3,
            "hops_used": p["hops"],
            "battery_level": p["batt"] if tele else None, "voltage": p["volt"] if tele else None,
            "channel_utilization": p["cu"] if tele else None, "air_util_tx": p["air"] if tele else None,
            "rx_time": int(ts)})
    return pd.DataFrame(rows, columns=LOG_COLS)


EVENT_NOTES = {
    "walkout": "SIMULATED: carrying node out of range", "obstruction": "SIMULATED: node blocked by obstruction",
    "stepwise_fade": "SIMULATED: slow stepwise fade begins", "water": "SIMULATED: water on node",
    "hard_unplug": "SIMULATED: node unplugged", "relay_failure": "SIMULATED: relay unplugged",
    "brownout": "SIMULATED: battery starts sagging", "short_dip": "SIMULATED: short signal dip",
    "interference_burst": "SIMULATED: interference burst", "walk_away_back": "SIMULATED: walk away and back",
}


def node_id(rng):
    return "!" + "".join(rng.choice(list("0123456789abcdef"), 8))
