import io
import os
import sys

import numpy as np
import pytest
from PIL import Image

# Ensure the repo root is importable so `from api...` and `from pipeline...`
# resolve when pytest is run from anywhere.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _png_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), mode="L").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def gradient_png() -> bytes:
    """64x64 gradient with a clean range of tones."""
    rows = np.tile(np.linspace(0, 255, 64, dtype=np.uint8), (64, 1))
    return _png_bytes(rows)


@pytest.fixture
def flat_png() -> bytes:
    """Single-tone image; should trip the degenerate guard."""
    return _png_bytes(np.full((32, 32), 128, dtype=np.uint8))


@pytest.fixture
def client_unauthed(monkeypatch):
    """TestClient with no INTERNAL_TOKEN — backend skips the auth gate."""
    monkeypatch.delenv("INTERNAL_TOKEN", raising=False)
    # Reload main so module-level INTERNAL_TOKEN reflects the unset var.
    import importlib

    import api.main as main

    importlib.reload(main)
    from fastapi.testclient import TestClient

    return TestClient(main.app)


@pytest.fixture
def client_authed(monkeypatch):
    """TestClient with INTERNAL_TOKEN set; tests must include the header."""
    monkeypatch.setenv("INTERNAL_TOKEN", "test-token-1234")
    import importlib

    import api.main as main

    importlib.reload(main)
    from fastapi.testclient import TestClient

    return TestClient(main.app), "test-token-1234"
