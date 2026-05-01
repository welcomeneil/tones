import numpy as np

from api.algorithms import histogram_peaks, kmeans_1d, multi_otsu
from api.algorithms._shared import load_grayscale


def decode(image_bytes: bytes) -> np.ndarray:
    return load_grayscale(image_bytes)


def segment(gray: np.ndarray, algo: str = "peaks", n: int = 5, sigma: float = 2.0):
    if algo == "peaks":
        return histogram_peaks.run(gray, sigma=sigma)
    if algo == "kmeans":
        return kmeans_1d.run(gray, n=n)
    if algo == "otsu":
        return multi_otsu.run(gray, n=n)
    raise ValueError(f"unknown algo: {algo}")


def run_pipeline(image_bytes: bytes, algo: str = "peaks", n: int = 5, sigma: float = 2.0):
    return segment(decode(image_bytes), algo=algo, n=n, sigma=sigma)
