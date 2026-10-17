"""predict_all.py runs on the cached realtime files (offline: no network)."""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not (ROOT / "models" / "thresholds.json").exists(),
                                reason="run python run_all.py first to create the models")


def test_predict_all_offline_on_cached_realtime(tmp_path):
    import predict_all
    out_file = tmp_path / "readings.json"
    out = predict_all.main(["--offline", "--out", str(out_file)])
    saved = json.loads(out_file.read_text())
    assert saved.keys() == out.keys()
    have = [s for s in out if (ROOT / "data" / "realtime" / f"{s}_realtime.csv").exists()
            or (ROOT / f"{s}_realtime.csv").exists()]
    assert len(have) >= 3
    for s in have:
        assert out[s]["p"] is not None and 0.0 <= out[s]["p"] <= 1.0
        assert out[s]["level"] in ("NONE", "WATCH", "WARNING")
