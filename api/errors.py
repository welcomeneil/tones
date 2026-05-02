"""Single-shape error envelope and global exception handlers.

Every error path in the API — domain exceptions, framework exceptions,
validation failures, and unexpected crashes — returns the same JSON shape:

    {"error": {"code": "<machine-readable>", "message": "<human-readable>"}}

The frontend treats `code` as the contract; `message` is for display.
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from api.algorithms._shared import DegenerateImageError

log = logging.getLogger("tone_zone.errors")


def _envelope(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


_STATUS_TO_CODE = {
    400: "bad_request",
    401: "unauthorized",
    404: "not_found",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "unprocessable",
    500: "internal",
}


def api_error(status: int, code: str, message: str) -> HTTPException:
    """Raise this from route handlers; the HTTPException handler unpacks it."""
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _rid_headers(request: Request) -> dict[str, str]:
    rid = getattr(request.state, "request_id", None)
    return {"x-request-id": rid} if rid else {}


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(DegenerateImageError)
    async def _degenerate(request: Request, exc: DegenerateImageError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content=_envelope("degenerate_image", str(exc)),
            headers=_rid_headers(request),
        )

    @app.exception_handler(HTTPException)
    async def _http(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail and "message" in detail:
            content = _envelope(str(detail["code"]), str(detail["message"]))
        else:
            code = _STATUS_TO_CODE.get(exc.status_code, "error")
            message = str(detail) if detail else _STATUS_TO_CODE.get(exc.status_code, "error")
            content = _envelope(code, message)
        return JSONResponse(status_code=exc.status_code, content=content, headers=_rid_headers(request))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else None
        message = first.get("msg", "invalid request") if first else "invalid request"
        return JSONResponse(
            status_code=400,
            content=_envelope("bad_request", message),
            headers=_rid_headers(request),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        rid = getattr(request.state, "request_id", "-")
        log.exception(
            "unhandled exception rid=%s %s %s", rid, request.method, request.url.path
        )
        return JSONResponse(
            status_code=500,
            content=_envelope("internal", "unexpected server error"),
            headers={"x-request-id": rid} if rid != "-" else {},
        )
