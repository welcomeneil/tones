import numpy as np

from api.algorithms._shared import (
    compute_histogram,
    palette_from_zones,
    zones_from_boundaries,
)


def _kmeans_plus_plus_init(
    values: np.ndarray, weights: np.ndarray, k: int, rng: np.random.Generator
) -> np.ndarray:
    # Weighted k-means++: first center sampled proportional to weight; subsequent
    # centers sampled proportional to weight * (min squared distance to chosen centers).
    probs = weights / weights.sum()
    first = int(rng.choice(len(values), p=probs))
    centers = [values[first]]
    min_d2 = (values - centers[0]) ** 2
    for _ in range(1, k):
        p = weights * min_d2
        s = p.sum()
        idx = int(rng.choice(len(values), p=(p / s) if s > 0 else probs))
        centers.append(values[idx])
        min_d2 = np.minimum(min_d2, (values - values[idx]) ** 2)
    return np.array(sorted(centers), dtype=float)


def _lloyd_1d(
    values: np.ndarray,
    weights: np.ndarray,
    centers: np.ndarray,
    max_iter: int = 100,
    tol: float = 1e-6,
) -> np.ndarray:
    for _ in range(max_iter):
        midpoints = (centers[:-1] + centers[1:]) / 2
        assignments = np.digitize(values, midpoints)
        new_centers = np.empty_like(centers)
        for k in range(len(centers)):
            mask = assignments == k
            w = weights[mask]
            if w.sum() == 0:
                new_centers[k] = centers[k]
            else:
                new_centers[k] = (values[mask] * w).sum() / w.sum()
        new_centers.sort()
        if np.max(np.abs(new_centers - centers)) < tol:
            return new_centers
        centers = new_centers
    return centers


def run(gray: np.ndarray, n: int = 5, seed: int = 0):
    counts = compute_histogram(gray).astype(float)
    values = np.arange(256, dtype=float)
    mask = counts > 0
    v_used = values[mask]
    w_used = counts[mask]
    k = min(n, len(v_used))
    if k < 2:
        raise ValueError("not enough distinct luminosity values")
    rng = np.random.default_rng(seed)
    centers = _kmeans_plus_plus_init(v_used, w_used, k, rng)
    centers = _lloyd_1d(v_used, w_used, centers)
    centers.sort()
    boundaries = np.round((centers[:-1] + centers[1:]) / 2).astype(int)
    zones = zones_from_boundaries(gray, boundaries)
    palette = palette_from_zones(gray, zones)
    return zones, palette, boundaries
