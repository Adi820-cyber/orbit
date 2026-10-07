"""Outbreak-watch forecast (ADR 0023).

Reads daily patients per hospital and presenting condition from the database
(counts only, through orbit_erp.condition_daily_counts), trains an XGBoost model
with a Poisson objective to predict each hospital's patients for each condition
over the coming window, measures it against a naive baseline on held-out recent
weeks, and stores the forecast with the probabilities of crossing the
organization's surge rule (orbit_erp.store_forecast_run).

Run daily by .github/workflows/forecast.yml. Needs DATABASE_URL (orbit_app,
transaction pooler). Writes nothing but the forecast tables.

Honesty rules, in code below:
  * the model's error and the baseline's are both stored and shown to leaders;
  * probabilities assume Poisson counts around the predicted mean and treat
    hospitals as independent, and the stored notes say so;
  * an organization without enough history gets no forecast rather than a guess.
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import xgboost as xgb

MODEL_NAME = f"XGBoost {xgb.__version__} count:poisson"
HOLDOUT_DAYS = 56          # the last eight weeks of forecast origins are held out for the accuracy check
MIN_HISTORY_DAYS = 120     # less history than this: no forecast
SEED = 20261007

FEATURES = [
    "last_1", "last_7", "last_14", "last_28", "prior_7",
    "group_condition_7", "hospital_all_7", "weekday", "month", "condition", "facility",
]


@dataclass
class Series:
    """Dense daily counts: counts[facility, condition, day]."""

    start: date
    facilities: list[str]
    conditions: list[str]
    counts: np.ndarray  # shape (F, C, D), float

    @property
    def days(self) -> int:
        return int(self.counts.shape[2])


def build_series(rows: list[tuple[str, str, date, int]], facilities: list[str], conditions: list[str],
                 start: date, through: date) -> Series:
    """Rows of (facility_id, condition_id, day, patients) to a dense array; unknown ids are ignored."""
    f_index = {f: i for i, f in enumerate(facilities)}
    c_index = {c: i for i, c in enumerate(conditions)}
    days = (through - start).days + 1
    counts = np.zeros((len(facilities), len(conditions), max(days, 0)), dtype=np.float64)
    for facility, condition, day, patients in rows:
        fi, ci, di = f_index.get(facility), c_index.get(condition), (day - start).days
        if fi is None or ci is None or not 0 <= di < days:
            continue
        counts[fi, ci, di] += patients
    return Series(start, facilities, conditions, counts)


def _window_sum(cumulative: np.ndarray, end: int, length: int) -> np.ndarray:
    """Sum over days (end - length, end], from a cumulative array padded with a leading zero."""
    lo = max(end - length, -1)
    return cumulative[..., end + 1] - cumulative[..., lo + 1]


def features_at(series: Series, t: int) -> np.ndarray:
    """One row per (facility, condition) describing the history up to and including day t."""
    counts = series.counts
    cumulative = np.concatenate([np.zeros(counts.shape[:2] + (1,)), np.cumsum(counts, axis=2)], axis=2)
    f_count, c_count = counts.shape[:2]
    last_7 = _window_sum(cumulative, t, 7)
    group_7 = last_7.sum(axis=0, keepdims=True).repeat(f_count, axis=0)
    hospital_7 = last_7.sum(axis=1, keepdims=True).repeat(c_count, axis=1)
    day = series.start + timedelta(days=t)
    rows = np.stack(
        [
            counts[:, :, t],
            last_7,
            _window_sum(cumulative, t, 14),
            _window_sum(cumulative, t, 28),
            _window_sum(cumulative, t - 7, 7),
            group_7,
            hospital_7,
            np.full((f_count, c_count), day.weekday()),
            np.full((f_count, c_count), day.month),
            np.tile(np.arange(c_count), (f_count, 1)),
            np.tile(np.arange(f_count)[:, None], (1, c_count)),
        ],
        axis=-1,
    )
    return rows.reshape(-1, len(FEATURES))


def target_after(series: Series, t: int, horizon: int) -> np.ndarray:
    """Patients in days (t, t + horizon], per (facility, condition), flattened like features_at."""
    return series.counts[:, :, t + 1 : t + 1 + horizon].sum(axis=2).reshape(-1)


def poisson_at_least(mean: float, k: int) -> float:
    """P(N >= k) for N ~ Poisson(mean)."""
    if k <= 0:
        return 1.0
    if mean <= 0:
        return 0.0
    term = math.exp(-mean)
    below = term
    for i in range(1, k):
        term *= mean / i
        below += term
    return float(min(1.0, max(0.0, 1.0 - below)))


def at_least_of_independent(probabilities: list[float], k: int) -> float:
    """P(at least k of independent events), each with its own probability (Poisson-binomial)."""
    dist = [1.0]
    for p in probabilities:
        nxt = [0.0] * (len(dist) + 1)
        for j, mass in enumerate(dist):
            nxt[j] += mass * (1 - p)
            nxt[j + 1] += mass * p
        dist = nxt
    return float(min(1.0, max(0.0, sum(dist[k:]))))


PARAMS = {
    "objective": "count:poisson",
    "max_depth": 4,
    "eta": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 5,
    "seed": SEED,
    "nthread": 2,
}
ROUNDS = 300


def train(x: np.ndarray, y: np.ndarray) -> xgb.Booster:
    """XGBoost's native API: no scikit-learn needed."""
    return xgb.train(PARAMS, xgb.DMatrix(x, label=y, feature_names=FEATURES), num_boost_round=ROUNDS)


def predict(model: xgb.Booster, x: np.ndarray) -> np.ndarray:
    return model.predict(xgb.DMatrix(x, feature_names=FEATURES))


@dataclass
class Forecast:
    model_mae: float
    baseline_mae: float
    training_rows: int
    expected: np.ndarray  # shape (F, C): expected patients in the coming window


def forecast(series: Series, horizon: int) -> Forecast | None:
    """Train, check against the naive baseline on held-out recent origins, retrain on all, predict."""
    last_origin = series.days - 1 - horizon      # the last day whose next `horizon` days are all known
    first_origin = 28                            # enough history for the 28-day features
    if series.days < MIN_HISTORY_DAYS or last_origin - first_origin < HOLDOUT_DAYS + 28:
        return None

    origins = list(range(first_origin, last_origin + 1))
    split = last_origin - HOLDOUT_DAYS
    x_train = np.vstack([features_at(series, t) for t in origins if t <= split])
    y_train = np.concatenate([target_after(series, t, horizon) for t in origins if t <= split])
    x_hold = np.vstack([features_at(series, t) for t in origins if t > split])
    y_hold = np.concatenate([target_after(series, t, horizon) for t in origins if t > split])

    model = train(x_train, y_train)
    model_mae = float(np.mean(np.abs(predict(model, x_hold) - y_hold)))
    # Naive baseline: the coming window repeats the last one (scaled to the horizon).
    last_7 = x_hold[:, FEATURES.index("last_7")]
    baseline_mae = float(np.mean(np.abs(last_7 * horizon / 7 - y_hold)))

    x_all = np.vstack([x_train, x_hold])
    final = train(x_all, np.concatenate([y_train, y_hold]))
    today = series.days - 1
    expected = np.clip(predict(final, features_at(series, today)), 0, None).reshape(series.counts.shape[:2])
    return Forecast(model_mae, baseline_mae, int(x_all.shape[0]), expected)


def run_payload(org: str, series: Series, result: Forecast, horizon: int, min_patients: int, min_hospitals: int) -> dict:
    rows = []
    for ci, condition in enumerate(series.conditions):
        per_hospital = [float(result.expected[fi, ci]) for fi in range(len(series.facilities))]
        for fi, facility in enumerate(series.facilities):
            rows.append({"conditionId": condition, "facilityId": facility, "expectedPatients": round(per_hospital[fi], 3)})
        total = sum(per_hospital)
        rows.append({
            "conditionId": condition,
            "facilityId": "",
            "expectedPatients": round(total, 3),
            "pPatients": round(poisson_at_least(total, min_patients), 5),
            "pHospitals": round(at_least_of_independent([1 - math.exp(-m) for m in per_hospital], min_hospitals), 5),
        })
    through = series.start + timedelta(days=series.days - 1)
    return {
        "organizationId": org,
        "model": MODEL_NAME,
        "dataThrough": through.isoformat(),
        "horizonDays": horizon,
        "trainingRows": result.training_rows,
        "modelMae": round(result.model_mae, 3),
        "baselineMae": round(result.baseline_mae, 3),
        "notes": (
            f"Trained on daily patients per hospital and condition from {series.start.isoformat()} to {through.isoformat()}; "
            f"accuracy measured on the last {HOLDOUT_DAYS // 7} weeks held out. Probabilities assume Poisson counts around "
            "the predicted mean and independent hospitals. The reference history spreads conditions evenly, so there is "
            "little genuine pattern to learn."
        ),
        "rows": rows,
    }


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("forecast: DATABASE_URL is required", file=sys.stderr)
        return 2
    import psycopg  # imported here so the pure functions above test without a database driver

    # Transaction-mode pooler: no server-side prepared statements.
    with psycopg.connect(url, prepare_threshold=None, autocommit=True) as conn:
        inputs = conn.execute(
            "select organization_id::text, timezone, window_days, min_patients, min_hospitals, "
            "facility_ids::text[], condition_ids::text[] from orbit_erp.forecast_inputs()"
        ).fetchall()
        for org, zone, window_days, min_patients, min_hospitals, facilities, conditions in inputs:
            today = conn.execute("select (now() at time zone %s)::date", (zone,)).fetchone()[0]
            through = today - timedelta(days=1)  # today is not over yet
            start = through - timedelta(days=6 * 365)
            counts = conn.execute(
                "select facility_id::text, condition_id::text, day, patients from orbit_erp.condition_daily_counts(%s) "
                "where organization_id = %s::uuid and day <= %s",
                (start, org, through),
            ).fetchall()
            if not counts:
                print(f"forecast: {org}: no presenting conditions recorded yet; skipped")
                continue
            first_day = min(row[2] for row in counts)
            series = build_series(counts, list(facilities), list(conditions), max(start, first_day), through)
            result = forecast(series, window_days)
            if result is None:
                print(f"forecast: {org}: only {series.days} days of history; skipped (needs {MIN_HISTORY_DAYS})")
                continue
            payload = run_payload(org, series, result, window_days, min_patients, min_hospitals)
            run_id = conn.execute("select orbit_erp.store_forecast_run(%s::jsonb)", (json.dumps(payload),)).fetchone()[0]
            beats = "beats" if result.model_mae < result.baseline_mae else "does NOT beat"
            print(
                f"forecast: {org}: run {run_id}, {result.training_rows} rows, model MAE {result.model_mae:.3f} "
                f"{beats} baseline MAE {result.baseline_mae:.3f}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
