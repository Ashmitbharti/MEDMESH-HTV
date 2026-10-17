"""Emergency-department waiting times from queueing theory.

Each ED is modelled as an M/M/c queue: Poisson arrivals, exponential treatment times, c treatment spaces.
Patients are seen by triage priority (red before yellow before green), without interrupting a patient who
is already being treated: a non-preemptive priority queue. Mean wait for priority class k is Cobham's formula

    W_k = C(c, a) / (c * mu) / ((1 - s_{k-1}) * (1 - s_k)),     s_k = sum_{i<=k} lambda_i / (c * mu)

where C(c, a) is the Erlang C probability that an arriving patient has to wait (a = lambda / mu).

Calibration: the baseline arrival rate of each ED is solved (bisection) so that the model's average FIFO wait
equals the hospital's published / reported average wait. Live dispatches from MedMesh are added on top as
extra arrivals, so the predicted wait rises as we send patients there: this is what spreads load.

Modelling assumptions (stated, not medical facts): class mix of baseline arrivals, mean treatment time.
"""
import math

CLASS_MIX = (0.10, 0.35, 0.55)  # assumed share of red / yellow / green among baseline ED arrivals
OVERLOAD_MIN = 600.0            # reported when the queue is unstable (arrivals >= capacity)


def erlang_c(c, a):
    """Probability an arrival waits in M/M/c with offered load a = lambda/mu (requires a < c)."""
    if c <= 0:
        return 1.0
    if a <= 0:
        return 0.0
    if a >= c:
        return 1.0
    # Erlang B by the stable recursion, then convert to Erlang C
    b = 1.0
    for k in range(1, c + 1):
        b = a * b / (k + a * b)
    return c * b / (c - a * (1 - b))


def fifo_wait(c, lam, mu):
    """Mean wait (same time unit as 1/mu) in FIFO M/M/c."""
    if lam >= c * mu:
        return OVERLOAD_MIN
    return erlang_c(c, lam / mu) / (c * mu - lam)


def priority_waits(c, lams, mu):
    """Mean wait per priority class (index 0 = highest) in non-preemptive priority M/M/c (Cobham)."""
    lam = sum(lams)
    if c <= 0:
        return [OVERLOAD_MIN] * len(lams)
    # when the ED as a whole is overloaded every server is busy (Erlang C -> 1): high-priority classes still
    # get finite waits, only the classes whose cumulative load reaches capacity grow without bound
    base = (erlang_c(c, lam / mu) if lam < c * mu else 1.0) / (c * mu)
    out, s_prev = [], 0.0
    for lk in lams:
        s_k = s_prev + lk / (c * mu)
        if s_k >= 1:
            out.append(OVERLOAD_MIN)
        else:
            out.append(min(OVERLOAD_MIN, base / ((1 - s_prev) * (1 - s_k))))
        s_prev = s_k
    return out


def calibrate_lambda(c, mu, target_wait):
    """Arrival rate that reproduces an observed average wait (bisection; FIFO wait rises monotonically)."""
    lo, hi = 0.0, c * mu * 0.999
    if target_wait <= 0:
        return 0.0
    if fifo_wait(c, hi, mu) < target_wait:
        return hi
    for _ in range(60):
        mid = (lo + hi) / 2
        if fifo_wait(c, mid, mu) < target_wait:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


class ERQueue:
    """Queue model for one hospital's emergency department. Times in minutes."""

    def __init__(self, spaces, svc_min, avg_wait_min):
        self.c = max(1, int(spaces))
        self.mu = 1.0 / max(1.0, float(svc_min))
        self.recalibrate(avg_wait_min)
        self.extra = [0.0, 0.0, 0.0]  # live arrivals/min added by MedMesh dispatches, per class

    def recalibrate(self, avg_wait_min):
        self.avg_wait = float(avg_wait_min)
        self.base_lam = calibrate_lambda(self.c, self.mu, self.avg_wait)

    def lams(self, add_class=None, add_rate=0.0):
        lam = [self.base_lam * m + x for m, x in zip(CLASS_MIX, self.extra)]
        if add_class is not None:
            lam[add_class] += add_rate
        return lam

    def wait(self, klass, add_rate=0.0):
        """Predicted wait (min) for a new patient of class 0/1/2, optionally assuming extra arrivals."""
        return priority_waits(self.c, self.lams(klass if add_rate else None, add_rate), self.mu)[klass]

    def utilisation(self):
        return sum(self.lams()) / (self.c * self.mu)

    def snapshot(self):
        w = priority_waits(self.c, self.lams(), self.mu)
        return {"spaces": self.c, "svc_min": round(1 / self.mu), "calibrated_to_min": self.avg_wait,
                "arrivals_per_hr": round(sum(self.lams()) * 60, 1), "utilisation": round(self.utilisation(), 2),
                "wait_red": round(w[0], 1), "wait_yellow": round(w[1], 1), "wait_green": round(w[2], 1)}
