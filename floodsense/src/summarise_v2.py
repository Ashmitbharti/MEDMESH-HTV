"""Condense results/model_comparison_v2.csv into the per-station answers for the README.

python -m src.summarise_v2
"""
import json

import pandas as pd

from .config import RESULTS_DIR


def main():
    t = pd.read_csv(RESULTS_DIR / "model_comparison_v2.csv")
    winners = json.loads((RESULTS_DIR / "v2" / "winners_v2.json").read_text())
    pd.set_option("display.width", 250)

    print("=== Feature sets (LightGBM, CV PR-AUC on train, mean +/- std) ===")
    sc = t[(t.experiment == "set_compare") & (t.split == "test")]
    piv = sc.assign(cv=sc.cv_pr_auc.round(3).astype(str) + "+/-" + sc.cv_std.round(3).astype(str)) \
        .pivot_table(index=["station", "target", "pct"], columns="feature_set", values="cv", aggfunc="first")
    print(piv[["LEVEL_ONLY", "LEAN", "BIG", "LEAN_NO_RAIN"]].to_string())

    print("\n=== Rain ablation (LightGBM, LEAN vs LEAN_NO_RAIN): CV / val PR-AUC / test PR-AUC / test events ===")
    for (st, tg, p), g in sc.groupby(["station", "target", "pct"]):
        a = g.set_index("feature_set")
        v = t[(t.experiment == "set_compare") & (t.split == "val") & (t.station == st) & (t.target == tg)
              & (t.pct == p)].set_index("feature_set")
        print(f"  {st} {tg:<4} p{p}: CV {a.loc['LEAN', 'cv_pr_auc']:.3f} vs {a.loc['LEAN_NO_RAIN', 'cv_pr_auc']:.3f} | "
              f"val {v.loc['LEAN', 'pr_auc']:.3f} vs {v.loc['LEAN_NO_RAIN', 'pr_auc']:.3f} | "
              f"test {a.loc['LEAN', 'pr_auc']:.3f} vs {a.loc['LEAN_NO_RAIN', 'pr_auc']:.3f} | events "
              f"{a.loc['LEAN', 'events_caught']}/{a.loc['LEAN', 'events']} vs "
              f"{a.loc['LEAN_NO_RAIN', 'events_caught']}/{a.loc['LEAN_NO_RAIN', 'events']}")

    print("\n=== Winner (chosen on validation) vs persistence, TEST ===")
    for st, combos in winners.items():
        for key, w in combos.items():
            tg, p = key.split("/")
            p = int(p[1:])
            g = t[(t.station == st) & (t.target == tg) & (t.pct == p) & (t.split == "test")]
            m = g[(g.experiment == "models") & (g.model == w["winner"])].iloc[0]
            b = g[g.model == "persistence"].iloc[0]
            beats = m.f2 > b.f2
            db = "" if tg == "same" else f", fired day before {int(m.events_day_before)}/{m.events}"
            print(f"  {st} {tg:<4} p{p} {w['feature_set']:<4} {w['winner']:<6} prec {m.precision:.3f} rec {m.recall:.3f} "
                  f"F2 {m.f2:.3f} PR-AUC {m.pr_auc:.3f} (CV {m.cv_pr_auc:.3f}+/-{m.cv_std:.3f}) events "
                  f"{m.events_caught}/{m.events}{db} | persistence F2 {b.f2:.3f} PR-AUC {b.pr_auc:.3f} events "
                  f"{b.events_caught}/{b.events} -> {'BEATS' if beats else 'DOES NOT BEAT'} persistence on F2")


if __name__ == "__main__":
    main()
