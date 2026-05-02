"""Numerical and contract tests for the segmentation algorithms."""

import numpy as np
import pytest

from api.algorithms import histogram_peaks, kmeans_1d
from api.algorithms._shared import (
    DegenerateImageError,
    compute_histogram,
    require_tonal_variation,
)
from pipeline import segment


def _gradient(h: int = 64, w: int = 64) -> np.ndarray:
    return np.tile(np.linspace(0, 255, w, dtype=np.uint8), (h, 1))


def test_compute_histogram_sums_to_pixel_count():
    g = _gradient()
    counts = compute_histogram(g)
    assert counts.shape == (256,)
    assert counts.sum() == g.size


def test_require_tonal_variation_passes_on_gradient():
    require_tonal_variation(_gradient())  # should not raise


def test_require_tonal_variation_raises_on_flat():
    flat = np.full((16, 16), 200, dtype=np.uint8)
    with pytest.raises(DegenerateImageError):
        require_tonal_variation(flat)


def test_kmeans_returns_correct_shape_and_palette_size():
    g = _gradient()
    zones, palette, boundaries = kmeans_1d.run(g, n=5)
    assert zones.shape == g.shape
    assert len(palette) == 5
    assert len(boundaries) == 4
    # Palette is monotonically non-decreasing in luminosity (sorted centers).
    assert palette == sorted(palette)
    # All zone indices in [0, n-1].
    assert zones.min() >= 0 and zones.max() < 5


def test_kmeans_is_deterministic():
    g = _gradient()
    a = kmeans_1d.run(g, n=5)
    b = kmeans_1d.run(g, n=5)
    np.testing.assert_array_equal(a[0], b[0])
    assert a[1] == b[1]
    np.testing.assert_array_equal(a[2], b[2])


def test_peaks_returns_consistent_shapes():
    g = _gradient()
    zones, palette, boundaries = histogram_peaks.run(g, sigma=2.0)
    assert zones.shape == g.shape
    # Palette length = number of zones = boundaries + 1.
    assert len(palette) == len(boundaries) + 1
    assert zones.min() >= 0


def test_segment_dispatches_to_algos():
    g = _gradient()
    a = segment(g, algo="kmeans", n=4)
    b = segment(g, algo="peaks", sigma=3.0)
    assert len(a[1]) == 4
    assert len(b[1]) >= 1


def test_segment_rejects_unknown_algo():
    with pytest.raises(ValueError):
        segment(_gradient(), algo="bogus")


def test_segment_raises_on_degenerate_input():
    flat = np.full((16, 16), 50, dtype=np.uint8)
    with pytest.raises(DegenerateImageError):
        segment(flat, algo="kmeans", n=5)


def test_kmeans_handles_few_distinct_values():
    """If the image has fewer distinct values than n, k clamps to that count."""
    arr = np.array([[0, 128, 255]] * 16, dtype=np.uint8)
    zones, palette, boundaries = kmeans_1d.run(arr, n=10)
    assert len(palette) <= 3
    assert len(boundaries) == len(palette) - 1
