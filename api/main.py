import logging
import os
import secrets
import uuid

from fastapi import FastAPI, File, Header, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

from api import cache
from api.errors import api_error, install_handlers
from api.serialize import zone_index_to_png_bytes, zone_map_to_png_bytes
from pipeline import decode, segment

log = logging.getLogger("tone_zone.api")

# 5 MB matches the practical ceiling: the frontend downscales to 1200px
# (~150-300 KB JPEG); anything larger is either an unscaled raw upload or abuse.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")

app = FastAPI(title="tone_zone")
install_handlers(app)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Tag every request with an id so logs from Vercel and Fly can be correlated.

    Honors an inbound x-request-id (set by the Vercel proxy); generates one
    when absent. Stashed on request.state for handlers and echoed on responses.
    """

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response


app.add_middleware(RequestIdMiddleware)

allowed_origin = os.environ.get("ALLOWED_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _require_internal_token(request: Request, x_internal_token: str | None) -> None:
    """Reject public traffic that bypasses the Vercel proxy.

    The Vercel proxy sets x-internal-token; direct calls to the Fly URL don't.
    Skipped when INTERNAL_TOKEN is unset (local dev). Constant-time compare.
    """
    if INTERNAL_TOKEN is None:
        return
    if not x_internal_token or not secrets.compare_digest(x_internal_token, INTERNAL_TOKEN):
        log.warning(
            "rejected unauthenticated request rid=%s path=%s",
            getattr(request.state, "request_id", "-"),
            request.url.path,
        )
        raise api_error(401, "unauthorized", "missing or invalid internal token")


ALLOWED_ALGOS = {"peaks", "kmeans"}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ingest")
async def ingest(
    request: Request,
    file: UploadFile = File(...),
    x_internal_token: str | None = Header(default=None),
):
    _require_internal_token(request, x_internal_token)

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise api_error(413, "payload_too_large", "uploaded file exceeds 5 MB limit")

    contents = await file.read()
    if not contents:
        raise api_error(400, "empty_file", "uploaded file was empty")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise api_error(413, "payload_too_large", "uploaded file exceeds 5 MB limit")

    try:
        gray = decode(contents)
    except Exception as exc:
        raise api_error(422, "decode_failed", f"could not decode image: {exc}") from exc
    image_id = cache.put_image(gray)
    h, w = gray.shape
    return {"id": image_id, "width": int(w), "height": int(h)}


class AnalyzeBody(BaseModel):
    id: str
    algo: str = "kmeans"
    n: int = Field(default=5, ge=3, le=15)
    sigma: float = Field(default=2.0, ge=0.1, le=10.0)


@app.post("/analyze")
def analyze(
    request: Request,
    body: AnalyzeBody,
    x_internal_token: str | None = Header(default=None),
):
    _require_internal_token(request, x_internal_token)

    if body.algo not in ALLOWED_ALGOS:
        raise api_error(400, "bad_request", f"algo must be one of {sorted(ALLOWED_ALGOS)}")

    gray = cache.get_image(body.id)
    if gray is None:
        raise api_error(404, "image_not_found", "image expired from cache; please re-upload")

    # DegenerateImageError is caught by its dedicated handler (400 envelope).
    # Anything else bubbles to the catch-all handler (500 envelope).
    zones, palette, _boundaries = segment(gray, algo=body.algo, n=body.n, sigma=body.sigma)

    map_png = zone_map_to_png_bytes(zones, palette)
    index_png = zone_index_to_png_bytes(zones)
    version = cache.put_result(body.id, map_png, index_png)
    if version is None:
        raise api_error(404, "image_not_found", "image expired from cache; please re-upload")

    h, w = zones.shape
    return {
        "width": int(w),
        "height": int(h),
        "algo": body.algo,
        "n": body.n,
        "palette": [int(v) for v in palette],
        "mapUrl": f"/api/zone/{body.id}/map.png?v={version}",
        "indexUrl": f"/api/zone/{body.id}/index.png?v={version}",
    }


@app.get("/zone/{image_id}/{name}")
def get_zone_png(
    request: Request,
    image_id: str,
    name: str,
    x_internal_token: str | None = Header(default=None),
):
    _require_internal_token(request, x_internal_token)

    if name == "map.png":
        which = "map"
    elif name == "index.png":
        which = "index"
    else:
        raise api_error(404, "not_found", "unknown zone asset")
    data = cache.get_result_png(image_id, which)
    if data is None:
        raise api_error(404, "not_found", "zone asset not found")
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600, immutable"},
    )
