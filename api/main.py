import os

from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api import cache
from api.serialize import zone_index_to_png_bytes, zone_map_to_png_bytes
from pipeline import decode, segment

app = FastAPI(title="tone_zone")

allowed_origin = os.environ.get("ALLOWED_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

ALLOWED_ALGOS = {"peaks", "kmeans", "otsu"}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)):
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        gray = decode(contents)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"decode failed: {exc}") from exc
    image_id = cache.put_image(gray)
    h, w = gray.shape
    return {"id": image_id, "width": int(w), "height": int(h)}


class AnalyzeBody(BaseModel):
    id: str
    algo: str = "kmeans"
    n: int = Field(default=5, ge=3, le=15)
    sigma: float = Field(default=2.0, ge=0.1, le=10.0)


@app.post("/analyze")
def analyze(body: AnalyzeBody):
    if body.algo not in ALLOWED_ALGOS:
        raise HTTPException(status_code=400, detail=f"algo must be one of {sorted(ALLOWED_ALGOS)}")

    gray = cache.get_image(body.id)
    if gray is None:
        raise HTTPException(status_code=404, detail="unknown image id; re-ingest")

    try:
        zones, palette, boundaries = segment(gray, algo=body.algo, n=body.n, sigma=body.sigma)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"pipeline failed: {exc}") from exc

    map_png = zone_map_to_png_bytes(zones, palette)
    index_png = zone_index_to_png_bytes(zones)
    version = cache.put_result(body.id, map_png, index_png)
    if version is None:
        raise HTTPException(status_code=404, detail="unknown image id; re-ingest")

    h, w = zones.shape
    return {
        "width": int(w),
        "height": int(h),
        "algo": body.algo,
        "n": body.n,
        "palette": [int(v) for v in palette],
        "boundaries": [int(v) for v in boundaries.tolist()],
        "mapUrl": f"/api/zone/{body.id}/map.png?v={version}",
        "indexUrl": f"/api/zone/{body.id}/index.png?v={version}",
    }


@app.get("/zone/{image_id}/{name}")
def get_zone_png(image_id: str, name: str):
    if name == "map.png":
        which = "map"
    elif name == "index.png":
        which = "index"
    else:
        raise HTTPException(status_code=404)
    data = cache.get_result_png(image_id, which)
    if data is None:
        raise HTTPException(status_code=404, detail="not found")
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600, immutable"},
    )
