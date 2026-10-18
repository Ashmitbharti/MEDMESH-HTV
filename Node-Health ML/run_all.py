"""Model A (mesh link health): one entry point. All data is SIMULATED until real collect_min.py logs exist.

python run_all.py --fast    # 110-row coverage set: generate, leakage tests, train/evaluate, demo replay (fast)
python run_all.py           # the same plus the big simulated set (--big data, models/big/)
python run_all.py --big     # big simulated set only
"""
import argparse
import subprocess
import sys
import time

from common import RESULTS_DIR, ROOT


def run(cmd, log):
    line = "$ python " + " ".join(cmd)
    print("\n" + line, flush=True)
    log.write("\n" + line + "\n")
    p = subprocess.Popen([sys.executable, *cmd], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace")
    for out in p.stdout:
        sys.stdout.write(out)
        log.write(out)
    if p.wait():
        raise SystemExit(f"step failed: {line}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true", help="coverage set only, 5 shuffled-label repeats")
    ap.add_argument("--big", action="store_true", help="big simulated set only")
    a = ap.parse_args()
    RESULTS_DIR.mkdir(exist_ok=True)
    t0 = time.time()
    name = "run_all_fast.log" if a.fast else "run_all_big.log" if a.big else "run_all.log"
    with open(RESULTS_DIR / name, "w", encoding="utf-8") as log:
        shuffles = "5" if a.fast else "10"
        if not a.big:
            run(["make_coverage_data.py"], log)
        run(["-m", "pytest", "tests", "-q", "-p", "no:cacheprovider"], log)
        if not a.big:
            run(["train.py", "--data", "coverage", "--shuffles", shuffles], log)
        if not a.fast:
            run(["make_coverage_data.py", "--big"], log)
            run(["train.py", "--data", "big", "--shuffles", shuffles], log)
        if not a.big:
            run(["demo_replay.py", "--speed", "1000"], log)
        msg = f"\nrun_all done in {time.time() - t0:.0f}s; log in results/{name}"
        print(msg)
        log.write(msg + "\n")


if __name__ == "__main__":
    main()
