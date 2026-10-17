"""MedMesh dispatch engine.

The command centre's decision core. No AI calls anywhere in this package: every decision comes
from explicit models and optimisation, and every decision is logged with its inputs and reasons.

    routing    one-to-all shortest paths on the road graph (Dijkstra over a sparse matrix), flood-risk costs
    queueing   emergency-department waits: Erlang C + non-preemptive priority queue (Cobham's formula)
    patient    MedMesh ID profile (filled before the disaster) -> routing adjustments
    clinical   condition -> required capability, time-sensitivity curves (modelling assumptions, documented)
    estimator  hospital bed nowcast: Kalman filter that blends mesh reports with a forward model
    optimizer  per-patient ranking by expected outcome, and global patient->bed assignment (Hungarian)
    supply     multi-item pharmacy fulfilment: exact minimum-cost cover with order splitting
    dedup      spatio-temporal clustering of duplicate SOS reports
    audit      decision records + hash-chained append-only audit log
"""
from .routing import Router
from .queueing import ERQueue
from .clinical import profile_for
from .estimator import BedEstimator
from .optimizer import Engine
from .supply import plan_supply
from .dedup import DuplicateDetector
from .audit import AuditLog

__all__ = ["Router", "ERQueue", "profile_for", "BedEstimator", "Engine", "plan_supply", "DuplicateDetector", "AuditLog"]
