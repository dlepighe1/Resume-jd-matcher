"""Tests for src/train.py — the calibration and evaluation pieces.

main() itself fine-tunes MPNet and is far too slow for a test suite; what is
tested here is everything it depends on: the Platt calibrator that ships in
production, the pairwise cosine encoder, and the reported metrics.
"""

import pickle

import numpy as np
import pandas as pd
import pytest

from conftest import ScriptedEncoder
from src.train import PlattCalibrator, encode_pairs, metrics


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


class TestPlattCalibrator:
    def test_is_an_identity_sigmoid_before_fitting(self):
        assert PlattCalibrator()([0.0, 2.0]) == pytest.approx([0.5, sigmoid(2.0)])

    def test_recovers_a_known_sigmoid(self):
        raw = np.linspace(0.4, 0.95, 40)
        true = sigmoid(8.0 * raw - 5.0)

        calibrator = PlattCalibrator().fit(raw, true)

        assert calibrator.a == pytest.approx(8.0, abs=0.2)
        assert calibrator.b == pytest.approx(-5.0, abs=0.2)
        assert np.mean(np.abs(np.array(calibrator(raw)) - true)) < 0.01

    def test_decompresses_the_cosine_floor(self):
        """The reason calibration exists: fine-tuned cosines bunch up in ~0.5-0.9
        while true scores span 0-1. Calibration must cut the error on that spread."""
        raw = np.linspace(0.55, 0.90, 30)
        true = np.linspace(0.02, 0.98, 30)

        calibrator = PlattCalibrator().fit(raw, true)

        mae_raw = np.mean(np.abs(raw - true))
        mae_calibrated = np.mean(np.abs(np.array(calibrator(raw)) - true))
        assert mae_calibrated < mae_raw / 2

    def test_output_is_a_list_bounded_to_zero_one(self):
        out = PlattCalibrator().fit([0.5, 0.9], [0.1, 0.9])([-5.0, 0.7, 5.0])

        assert isinstance(out, list)
        assert all(0.0 <= v <= 1.0 for v in out)

    def test_is_monotonic(self):
        calibrator = PlattCalibrator().fit(np.linspace(0.5, 0.9, 20), np.linspace(0.1, 0.9, 20))

        out = calibrator([0.5, 0.6, 0.7, 0.8, 0.9])

        assert out == sorted(out)

    def test_survives_a_pickle_round_trip(self):
        """The app loads this straight off disk — params must persist."""
        calibrator = PlattCalibrator().fit(np.linspace(0.5, 0.9, 20), np.linspace(0.1, 0.9, 20))

        restored = pickle.loads(pickle.dumps(calibrator))

        assert (restored.a, restored.b) == (calibrator.a, calibrator.b)
        assert restored([0.7]) == pytest.approx(calibrator([0.7]))


class TestEncodePairs:
    def test_returns_row_wise_cosine_similarity(self):
        df = pd.DataFrame({"resume": ["r_same", "r_orthogonal"], "jd_clean": ["j_same", "j_orthogonal"]})
        model = ScriptedEncoder({
            "r_same": [1.0, 0.0], "j_same": [1.0, 0.0],              # cosine 1.0
            "r_orthogonal": [1.0, 0.0], "j_orthogonal": [0.0, 1.0],  # cosine 0.0
        })

        assert encode_pairs(model, df) == pytest.approx([1.0, 0.0])

    def test_scores_each_resume_against_its_own_jd(self):
        """A row-misaligned zip would silently score resume[i] against jd[j]."""
        df = pd.DataFrame({"resume": ["r0", "r1"], "jd_clean": ["j0", "j1"]})
        model = ScriptedEncoder({
            "r0": [1.0, 0.0], "j0": [0.0, 1.0],  # pair 0 -> 0.0
            "r1": [0.0, 1.0], "j1": [0.0, 1.0],  # pair 1 -> 1.0
        })

        assert encode_pairs(model, df) == pytest.approx([0.0, 1.0])


class TestMetrics:
    def test_perfect_ranking_scores_spearman_one(self):
        assert metrics([0.1, 0.5, 0.9], [0.2, 0.6, 0.8])["spearman"] == 1.0

    def test_inverted_ranking_scores_spearman_minus_one(self):
        assert metrics([0.1, 0.5, 0.9], [0.9, 0.5, 0.1])["spearman"] == -1.0

    def test_mae_is_the_mean_absolute_error(self):
        assert metrics([0.0, 1.0], [0.2, 0.7])["mae"] == pytest.approx(0.25)

    def test_values_are_rounded_to_four_places(self):
        result = metrics([0.0, 0.5, 1.0], [0.123456, 0.5, 0.987654])

        assert result["mae"] == round(result["mae"], 4)
        assert result["spearman"] == round(result["spearman"], 4)
