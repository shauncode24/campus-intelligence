"""The real route table of the RAG service as (METHOD, path) pairs, including routers added with
include_router (newer FastAPI wraps those, so iterating app.routes alone silently skips them)."""
from fastapi.routing import APIRoute


def _walk(routes, prefix=""):
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix, route
        ctx = getattr(route, "include_context", None)
        if ctx is not None:
            yield from _walk(ctx.included_router.routes, prefix + (ctx.prefix or ""))


def api_routes(app):
    out = []
    for prefix, route in _walk(app.routes):
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            out.append((method, prefix + route.path))
    return sorted(set(out))
