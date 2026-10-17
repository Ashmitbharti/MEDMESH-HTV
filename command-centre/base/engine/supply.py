"""Pharmacy / supply fulfilment: cover a multi-item order at minimum cost.

Given an order {item: qty}, a set of open pharmacies with stock, and road times to each, choose the set of
pharmacies to draw from that covers the whole order and minimises

    sum(road minutes to each chosen pharmacy) + STOP_MIN * (number of pharmacies)

This is a weighted set-multicover problem (NP-hard in general). With the handful of pharmacies in range of
one request it is solved EXACTLY by enumerating subsets in order of size (2^n, n <= 14); above that it falls
back to the classic greedy approximation (cost per unit of remaining demand covered).
If no combination can cover everything, it returns the plan that covers the most and reports the shortfall.
"""
from itertools import combinations

STOP_MIN = 10.0   # handling cost of involving one more pharmacy (assumption)
EXACT_MAX = 14


def _allocate(order, chosen, stock, minutes):
    """Draw each item from the nearest chosen pharmacy first."""
    alloc, short = {}, {}
    for item, qty in order.items():
        left = qty
        for pid in sorted(chosen, key=lambda p: minutes[p]):
            take = min(left, stock[pid].get(item, 0))
            if take > 0:
                alloc.setdefault(pid, {})[item] = take
                left -= take
            if left <= 0:
                break
        if left > 0:
            short[item] = left
    return alloc, short


def _covers(order, chosen, stock):
    return all(sum(stock[p].get(i, 0) for p in chosen) >= q for i, q in order.items())


def plan_supply(order, pharmacies, minutes):
    """order: {item: qty}; pharmacies: list of dicts (id, name, open, stock); minutes: {pid: road minutes or None}."""
    cands = [p for p in pharmacies if p.get("open") and minutes.get(p["id"]) is not None
             and any(p["stock"].get(i, 0) > 0 for i in order)]
    stock = {p["id"]: p["stock"] for p in cands}
    mins = {p["id"]: minutes[p["id"]] for p in cands}
    ids = [p["id"] for p in cands]
    cost = lambda S: sum(mins[p] for p in S) + STOP_MIN * len(S)
    best, method, examined = None, "exact", 0
    if len(ids) <= EXACT_MAX:
        sorted_m = sorted(mins.values())
        for k in range(1, len(ids) + 1):
            # branch-and-bound: no k-subset can cost less than the k cheapest stops
            if best is not None and STOP_MIN * k + sum(sorted_m[:k]) >= cost(best):
                break
            for S in combinations(ids, k):
                examined += 1
                if _covers(order, S, stock) and (best is None or cost(S) < cost(best)):
                    best = S
    else:
        method, remaining, S = "greedy", dict(order), []
        while remaining:
            def gain(p):
                return sum(min(q, stock[p].get(i, 0)) for i, q in remaining.items())
            opts = [p for p in ids if p not in S and gain(p) > 0]
            if not opts:
                break
            p = min(opts, key=lambda p: (mins[p] + STOP_MIN) / gain(p))
            S.append(p)
            for i in list(remaining):
                remaining[i] -= min(remaining[i], stock[p].get(i, 0))
                if remaining[i] <= 0:
                    del remaining[i]
            examined += 1
        best = tuple(S) if S else None
    if best is None:   # nothing covers it all: take every pharmacy that helps, nearest first
        best, method = tuple(sorted(ids, key=lambda p: mins[p])), method + "+partial"
    alloc, short = _allocate(order, best, stock, mins)
    return {"pharmacies": list(best), "allocation": alloc, "shortfall": short, "cost_min": round(cost(best), 1),
            "method": method, "subsets_examined": examined, "candidates": len(ids)}
