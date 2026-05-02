"""HTTP-level contract tests: error envelope, auth gate, size cap, happy path."""


def _envelope_shape(payload: dict) -> bool:
    err = payload.get("error")
    return (
        isinstance(err, dict)
        and isinstance(err.get("code"), str)
        and isinstance(err.get("message"), str)
    )


def test_health(client_unauthed):
    res = client_unauthed.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_ingest_empty_returns_envelope(client_unauthed):
    res = client_unauthed.post("/ingest", files={"file": ("x.png", b"", "image/png")})
    assert res.status_code == 400
    assert _envelope_shape(res.json())
    assert res.json()["error"]["code"] == "empty_file"


def test_ingest_decode_failure_returns_envelope(client_unauthed):
    res = client_unauthed.post(
        "/ingest", files={"file": ("x.png", b"not an image", "image/png")}
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "decode_failed"


def test_ingest_too_large_returns_413(client_unauthed):
    big = b"x" * (5 * 1024 * 1024 + 10)
    res = client_unauthed.post(
        "/ingest", files={"file": ("x.png", big, "image/png")}
    )
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "payload_too_large"


def test_analyze_unknown_id_returns_404(client_unauthed):
    res = client_unauthed.post(
        "/analyze", json={"id": "deadbeef" * 4, "algo": "kmeans", "n": 5, "sigma": 2.0}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "image_not_found"


def test_analyze_validation_error_returns_envelope(client_unauthed):
    res = client_unauthed.post(
        "/analyze", json={"id": "x", "algo": "kmeans", "n": 999, "sigma": 2.0}
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "bad_request"


def test_zone_unknown_asset_returns_envelope(client_unauthed):
    res = client_unauthed.get("/zone/abc/wrong.png")
    assert res.status_code == 404
    assert _envelope_shape(res.json())


def test_internal_token_required_when_set(client_authed):
    client, token = client_authed
    no_token = client.get("/health")
    assert no_token.status_code == 200  # /health is gated too — adjust if needed
    # The route-level gate is on ingest/analyze/zone, not /health.
    res = client.post(
        "/analyze", json={"id": "x" * 32, "algo": "kmeans", "n": 5, "sigma": 2.0}
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthorized"

    res2 = client.post(
        "/analyze",
        json={"id": "x" * 32, "algo": "kmeans", "n": 5, "sigma": 2.0},
        headers={"x-internal-token": token},
    )
    # Image not in cache, but auth passed.
    assert res2.status_code == 404
    assert res2.json()["error"]["code"] == "image_not_found"


def test_request_id_propagated(client_unauthed):
    res = client_unauthed.get("/health", headers={"x-request-id": "abc-123"})
    assert res.headers.get("x-request-id") == "abc-123"


def test_request_id_generated_when_missing(client_unauthed):
    res = client_unauthed.get("/health")
    assert res.headers.get("x-request-id")  # non-empty


def test_full_ingest_analyze_flow(client_unauthed, gradient_png):
    ingest_res = client_unauthed.post(
        "/ingest", files={"file": ("g.png", gradient_png, "image/png")}
    )
    assert ingest_res.status_code == 200
    image_id = ingest_res.json()["id"]
    assert ingest_res.json()["width"] == 64
    assert ingest_res.json()["height"] == 64

    analyze_res = client_unauthed.post(
        "/analyze",
        json={"id": image_id, "algo": "kmeans", "n": 5, "sigma": 2.0},
    )
    assert analyze_res.status_code == 200
    body = analyze_res.json()
    assert body["width"] == 64
    assert body["height"] == 64
    assert len(body["palette"]) == 5
    assert body["mapUrl"].startswith(f"/api/zone/{image_id}/map.png?v=")
    assert body["indexUrl"].startswith(f"/api/zone/{image_id}/index.png?v=")
    assert "boundaries" not in body  # removed from API contract

    map_res = client_unauthed.get(f"/zone/{image_id}/map.png")
    assert map_res.status_code == 200
    assert map_res.headers["content-type"] == "image/png"
    assert "max-age=3600" in map_res.headers.get("cache-control", "")

    bad = client_unauthed.get(f"/zone/{image_id}/wrong.png")
    assert bad.status_code == 404


def test_degenerate_image_returns_400_envelope(client_unauthed, flat_png):
    ingest_res = client_unauthed.post(
        "/ingest", files={"file": ("flat.png", flat_png, "image/png")}
    )
    assert ingest_res.status_code == 200
    image_id = ingest_res.json()["id"]
    res = client_unauthed.post(
        "/analyze",
        json={"id": image_id, "algo": "kmeans", "n": 5, "sigma": 2.0},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "degenerate_image"
