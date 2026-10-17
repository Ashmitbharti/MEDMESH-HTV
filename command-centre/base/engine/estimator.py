"""Hospital bed nowcast: a one-dimensional Kalman filter per hospital.

Nobody outside a hospital sees live bed counts. Between mesh reports (C|hospID|free|...), the engine
predicts free beds forward from:
  - beds it has itself assigned (exact, subtracted immediately so two patients never get the same bed)
  - walk-in admissions it cannot see (drift from the ED arrival model, or from the surge-forecast ML model)
  - discharges
and the uncertainty grows with time since the last report. When a report arrives, the Kalman update
blends it in (reports are trusted far more than the forecast) and the uncertainty collapses.

The optimiser uses a risk-averse capacity: mean - 1 standard deviation, so stale or uncertain hospitals
are naturally used less.
"""
import math
import time

PROCESS_VAR_PER_MIN = 0.04   # bed-count variance added per minute without a report (assumption)
REPORT_VAR = 0.25            # measurement noise of a staff report (beds^2)
FRESH_MIN = 10               # a report younger than this is shown as "reported"


class BedEstimator:
    def __init__(self, total, free, walkin_per_hr=1.0, discharge_per_hr=0.8, now=None):
        self.total = int(total)
        self.x = float(free)
        self.P = 0.5
        self.walkin = walkin_per_hr / 60.0
        self.discharge = discharge_per_hr / 60.0
        self.t = now if now is not None else time.time()
        self.last_report = self.t
        self.last_value = int(free)
        self.assigned_since_report = 0
        self.forecast = None   # optional callable(minutes_ahead) -> drift beds/min from the surge ML model

    def _advance(self, now):
        dt = max(0.0, (now - self.t) / 60.0)
        if dt:
            drift = self.forecast(0) if self.forecast else (self.discharge - self.walkin)
            self.x = min(self.total, max(0.0, self.x + drift * dt))
            self.P += PROCESS_VAR_PER_MIN * dt
            self.t = now

    def assign(self, n=1, now=None):
        self._advance(now if now is not None else time.time())
        self.x = max(0.0, self.x - n)
        self.assigned_since_report += n

    def release(self, n=1, now=None):
        self._advance(now if now is not None else time.time())
        self.x = min(self.total, self.x + n)

    def report(self, free, now=None):
        now = now if now is not None else time.time()
        self._advance(now)
        k = self.P / (self.P + REPORT_VAR)
        self.x = self.x + k * (float(free) - self.x)
        self.P = (1 - k) * self.P
        self.last_report, self.last_value, self.assigned_since_report = now, int(free), 0

    def state(self, now=None):
        now = now if now is not None else time.time()
        self._advance(now)
        age = (now - self.last_report) / 60.0
        sd = math.sqrt(self.P)
        return {"mean": round(self.x, 1), "sd": round(sd, 2), "effective": max(0.0, self.x - sd),
                "age_min": round(age, 1), "source": "reported" if age <= FRESH_MIN else "estimated",
                "last_report": self.last_value, "assigned_since_report": self.assigned_since_report}
