"""Gauge metadata (station_screen.csv) and great-circle distances."""
import numpy as np
import pandas as pd

from .config import SCREEN_FILE, find_input

EARTH_KM = 6371.0088


def load_gauges() -> pd.DataFrame:
    path = find_input(SCREEN_FILE)
    if not path.exists():
        raise SystemExit(f"Missing {SCREEN_FILE}")
    g = pd.read_csv(path, dtype={"station": str}).set_index("station")
    for c in ("lat", "lon"):
        if g[c].isna().any():
            raise SystemExit(f"{SCREEN_FILE}: missing {c} for {list(g.index[g[c].isna()])}")
    return g


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(a))


def distance_matrix(g: pd.DataFrame) -> pd.DataFrame:
    lat, lon = g["lat"].to_numpy(), g["lon"].to_numpy()
    d = haversine_km(lat[:, None], lon[:, None], lat[None, :], lon[None, :])
    return pd.DataFrame(d, index=g.index, columns=g.index)
