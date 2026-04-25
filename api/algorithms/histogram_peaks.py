import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

from api.algorithms._shared import (
    compute_histogram,
    palette_from_zones,
    zones_from_boundaries,
)


def run(gray: np.ndarray, sigma: float = 2.0):
    counts = compute_histogram(gray)
    smoothed = gaussian_filter1d(counts.astype(float), sigma=sigma)
    boundaries, _ = find_peaks(-smoothed)
    zones = zones_from_boundaries(gray, boundaries)
    palette = palette_from_zones(gray, zones)
    return zones, palette, boundaries
