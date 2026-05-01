"""In-memory cache: decoded grayscale per upload, plus latest rendered PNGs.

Single-process, thread-safe. Sized for one Fly machine — eviction is TTL-based
with a hard cap as a safety net. If the entry vanishes between ingest and a
later /analyze (machine restart, eviction), the client re-ingests.
"""

import threading
import time
from typing import Optional
from uuid import uuid4

import numpy as np

TTL_SECONDS = 600
MAX_ENTRIES = 32


class _Entry:
    __slots__ = ("gray", "map_png", "index_png", "version", "ts")

    def __init__(self, gray: np.ndarray) -> None:
        self.gray = gray
        self.map_png: Optional[bytes] = None
        self.index_png: Optional[bytes] = None
        self.version: int = 0
        self.ts: float = time.monotonic()


_lock = threading.Lock()
_entries: dict[str, _Entry] = {}


def _evict_locked() -> None:
    now = time.monotonic()
    for k in [k for k, e in _entries.items() if now - e.ts > TTL_SECONDS]:
        _entries.pop(k, None)
    if len(_entries) > MAX_ENTRIES:
        oldest = sorted(_entries.items(), key=lambda kv: kv[1].ts)
        for k, _ in oldest[: len(_entries) - MAX_ENTRIES]:
            _entries.pop(k, None)


def put_image(gray: np.ndarray) -> str:
    image_id = uuid4().hex
    with _lock:
        _entries[image_id] = _Entry(gray)
        _evict_locked()
    return image_id


def get_image(image_id: str) -> Optional[np.ndarray]:
    with _lock:
        e = _entries.get(image_id)
        if e is None:
            return None
        e.ts = time.monotonic()
        return e.gray


def put_result(image_id: str, map_png: bytes, index_png: bytes) -> Optional[int]:
    with _lock:
        e = _entries.get(image_id)
        if e is None:
            return None
        e.map_png = map_png
        e.index_png = index_png
        e.version += 1
        e.ts = time.monotonic()
        return e.version


def get_result_png(image_id: str, which: str) -> Optional[bytes]:
    with _lock:
        e = _entries.get(image_id)
        if e is None:
            return None
        e.ts = time.monotonic()
        if which == "map":
            return e.map_png
        if which == "index":
            return e.index_png
        return None
