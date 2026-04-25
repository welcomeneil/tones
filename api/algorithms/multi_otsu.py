import numpy as np

from api.algorithms._shared import (
    compute_histogram,
    palette_from_zones,
    zones_from_boundaries,
)


def run(gray: np.ndarray, n: int = 5):
    # Multi-level Otsu via dynamic programming.
    # Maximize sum over classes k of omega_k * mu_k^2 (between-class variance),
    # equivalent to minimizing within-class variance.
    # Complexity: O(n * L^2) with L=256.
    counts = compute_histogram(gray).astype(float)
    total = counts.sum()
    if total == 0 or n < 2:
        raise ValueError("invalid histogram or n < 2")
    L = 256
    p = counts / total

    # Prefix sums so class moments on [a..b] are O(1).
    P = np.concatenate(([0.0], np.cumsum(p)))  # P[i] = sum p[0..i-1]
    S = np.concatenate(([0.0], np.cumsum(np.arange(L) * p)))

    # score[a, b] = omega * mu^2 for class [a..b] (upper triangular, else -inf).
    a_idx = np.arange(L)[:, None]
    b_idx = np.arange(L)[None, :]
    w = np.clip(P[b_idx + 1] - P[a_idx], 0.0, None)
    s = S[b_idx + 1] - S[a_idx]
    with np.errstate(invalid="ignore", divide="ignore"):
        score = np.where(w > 0, s * s / w, 0.0)
    score[a_idx > b_idx] = -np.inf

    # DP: dp[k, b] = best score using k classes covering [0..b].
    # back[k, b] = starting index a of the last class.
    dp = np.full((n + 1, L), -np.inf)
    back = np.zeros((n + 1, L), dtype=int)
    dp[1] = score[0]
    for k in range(2, n + 1):
        prev = dp[k - 1]  # length L
        # candidate[a-1, b] = dp[k-1, a-1] + score[a, b] for a in 1..L-1
        candidate = prev[:-1, None] + score[1:]
        best_a_minus_1 = candidate.argmax(axis=0)
        dp[k] = candidate[best_a_minus_1, np.arange(L)]
        back[k] = best_a_minus_1 + 1

    # Reconstruct thresholds walking back from (n, L-1).
    thresholds = []
    b = L - 1
    for k in range(n, 1, -1):
        a = int(back[k, b])
        thresholds.append(a)
        b = a - 1
    boundaries = np.array(sorted(thresholds), dtype=int)
    zones = zones_from_boundaries(gray, boundaries)
    palette = palette_from_zones(gray, zones)
    return zones, palette, boundaries
