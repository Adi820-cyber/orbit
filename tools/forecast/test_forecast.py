"""Tests for the outbreak-watch forecast (stdlib unittest; no database)."""

import math
import unittest
from datetime import date, timedelta

import numpy as np

import forecast as fc


def synthetic(days: int = 400, surge_from: int | None = None, seed: int = 1) -> fc.Series:
    """Two hospitals, three conditions, steady Poisson counts; optionally a surge of condition 0 at the end."""
    rng = np.random.default_rng(seed)
    counts = rng.poisson(1.0, size=(2, 3, days)).astype(float)
    if surge_from is not None:
        ramp = np.arange(days - surge_from) * 0.5
        counts[:, 0, surge_from:] += rng.poisson(1.0 + ramp, size=(2, days - surge_from))
    return fc.Series(date(2025, 1, 1), ["f1", "f2"], ["c1", "c2", "c3"], counts)


class ProbabilityTests(unittest.TestCase):
    def test_poisson_tail(self):
        self.assertAlmostEqual(fc.poisson_at_least(0.0, 1), 0.0)
        self.assertAlmostEqual(fc.poisson_at_least(3.0, 0), 1.0)
        self.assertAlmostEqual(fc.poisson_at_least(2.0, 1), 1 - math.exp(-2.0), places=9)
        # Mean far above the threshold: almost certain; far below: almost never.
        self.assertGreater(fc.poisson_at_least(80.0, 50), 0.99)
        self.assertLess(fc.poisson_at_least(10.0, 50), 1e-6)

    def test_at_least_k_of_independent(self):
        self.assertAlmostEqual(fc.at_least_of_independent([1.0] * 5, 5), 1.0)
        self.assertAlmostEqual(fc.at_least_of_independent([0.5, 0.5], 2), 0.25)
        self.assertAlmostEqual(fc.at_least_of_independent([0.5, 0.5], 1), 0.75)
        self.assertAlmostEqual(fc.at_least_of_independent([0.9] * 4, 5), 0.0)


class FeatureTests(unittest.TestCase):
    def test_build_series_ignores_unknown_ids_and_days(self):
        start = date(2025, 1, 1)
        series = fc.build_series(
            [("f1", "c1", start, 2), ("f1", "c1", start, 1), ("zz", "c1", start, 9), ("f1", "c1", start + timedelta(days=99), 4)],
            ["f1"], ["c1"], start, start + timedelta(days=2),
        )
        self.assertEqual(series.counts.shape, (1, 1, 3))
        self.assertEqual(series.counts[0, 0, 0], 3)
        self.assertEqual(series.counts.sum(), 3)

    def test_window_features_and_target(self):
        series = fc.Series(date(2025, 1, 1), ["f1"], ["c1"], np.arange(40, dtype=float).reshape(1, 1, 40))
        row = fc.features_at(series, 30)[0]
        self.assertEqual(row[fc.FEATURES.index("last_1")], 30)
        self.assertEqual(row[fc.FEATURES.index("last_7")], sum(range(24, 31)))
        self.assertEqual(row[fc.FEATURES.index("prior_7")], sum(range(17, 24)))
        self.assertEqual(fc.target_after(series, 30, 7)[0], sum(range(31, 38)))


class ForecastTests(unittest.TestCase):
    def test_too_little_history_gives_no_forecast(self):
        self.assertIsNone(fc.forecast(synthetic(days=60), 7))

    def test_steady_counts_forecast_near_the_rate(self):
        result = fc.forecast(synthetic(), 7)
        self.assertIsNotNone(result)
        # Mean 1 patient a day per hospital and condition: about 7 over the next week.
        self.assertTrue(np.all(np.abs(result.expected - 7) < 3), result.expected)
        # On pure noise the model should be about as good as repeating last week, not wildly better.
        self.assertLess(result.model_mae, result.baseline_mae * 1.1)

    def test_a_growing_surge_is_forecast_above_the_others(self):
        result = fc.forecast(synthetic(surge_from=300), 7)
        self.assertGreater(result.expected[:, 0].min(), result.expected[:, 1:].max())

    def test_payload_carries_group_probabilities_and_honest_notes(self):
        series = synthetic(surge_from=300)
        result = fc.forecast(series, 7)
        payload = fc.run_payload("org", series, result, 7, min_patients=50, min_hospitals=2)
        group = [row for row in payload["rows"] if row["facilityId"] == ""]
        self.assertEqual(len(group), 3)
        surge = next(row for row in group if row["conditionId"] == "c1")
        self.assertGreater(surge["pPatients"], 0.5)
        self.assertGreater(surge["pHospitals"], 0.9)
        self.assertIn("Poisson", payload["notes"])
        self.assertGreaterEqual(payload["baselineMae"], 0)


if __name__ == "__main__":
    unittest.main()
