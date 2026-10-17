"""Shared paths and constants for FloodSense (raw-features baseline)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CLEAN_DIR = DATA_DIR / "clean"
RESULTS_DIR = ROOT / "results"
MODELS_DIR = ROOT / "models"

RANDOM_STATE = 42

# station number -> text that must appear in STATION_NAME
STATIONS = {
    "02HC033": "MIMICO",
    "02HC030": "ETOBICOKE",
    "02HC032": "EAST HUMBER",
}
RAIN_FILE = "6158731_rain_daily.csv"

DEFAULT_PCT = 97
ALSO_REPORT_PCT = 95
MAX_INTERP_GAP = 2
SPLIT_FRACS = (0.70, 0.15, 0.15)
CV_SPLITS = 5
CV_GAP = 3


def find_input(name: str) -> Path:
    """Inputs belong in data/; fall back to the project root, where the raw downloads currently sit."""
    for p in (DATA_DIR / name, ROOT / name):
        if p.exists():
            return p
    return DATA_DIR / name
