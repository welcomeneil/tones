from io import BytesIO
import numpy as np
from PIL import Image

# compress_level=1 trades ~10-20% size for a multi-x speedup over optimize=True;
# these PNGs are throwaway artifacts re-rendered on every parameter change.
_COMPRESS_LEVEL = 1


def zone_map_to_png_bytes(tonal_zones: np.ndarray, palette: list[int]) -> bytes:
    """Render the zone map as a grayscale PNG where each pixel = palette luminosity for that zone.

    This keeps the payload ~100x smaller than serializing the raw zone array as JSON,
    and lets the browser decode it natively via an <img> or canvas.
    """
    lut = np.array(palette, dtype=np.uint8)
    luminosity_img = lut[tonal_zones]
    buf = BytesIO()
    Image.fromarray(luminosity_img, mode="L").save(buf, format="PNG", compress_level=_COMPRESS_LEVEL)
    return buf.getvalue()


def zone_index_to_png_bytes(tonal_zones: np.ndarray) -> bytes:
    """Render the zone map as an 8-bit indexed PNG preserving the raw zone number per pixel.

    Lets the client recover zone index for hover interactions by reading ImageData.
    Limited to 256 zones, which is far above any realistic palette size.
    """
    index_img = tonal_zones.astype(np.uint8)
    buf = BytesIO()
    Image.fromarray(index_img, mode="L").save(buf, format="PNG", compress_level=_COMPRESS_LEVEL)
    return buf.getvalue()
