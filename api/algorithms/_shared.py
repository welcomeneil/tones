from io import BytesIO

import numpy as np
from PIL import Image


def load_grayscale(image_bytes: bytes) -> np.ndarray:
    return np.array(Image.open(BytesIO(image_bytes)).convert("L"))


def compute_histogram(gray: np.ndarray) -> np.ndarray:
    counts, _ = np.histogram(gray, bins=256, range=(0, 256))
    return counts


def zones_from_boundaries(gray: np.ndarray, boundaries: np.ndarray) -> np.ndarray:
    return np.digitize(gray, bins=boundaries)


def palette_from_zones(gray: np.ndarray, zones: np.ndarray) -> list[int]:
    return [round(float(np.mean(gray[zones == z]))) for z in np.unique(zones)]
