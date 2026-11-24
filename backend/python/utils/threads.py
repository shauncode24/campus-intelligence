"""
Keeping blocking work off the event loop.

The service is one asyncio event loop. Anything that blocks (Firestore's synchronous
client, torch inference, a Gemini call, PyMuPDF) stops EVERY other request, including
/health, until it returns. Two tools:

* `run_blocking(fn, *args)` runs a plain function in the thread pool.
* `offload_async_methods(cls)`: the repositories are `async def` for historical
  reasons but contain no real `await`: they call the synchronous Firestore client
  directly. This wraps each of them so the body runs in a worker thread. Call sites,
  signatures and tests are unchanged. Inside a worker thread (a repository method
  calling another one) the wrapper steps aside and just runs the body, so threads
  never wait on each other.
"""
import asyncio
import functools
import inspect
import threading

from starlette.concurrency import run_in_threadpool

_local = threading.local()


async def run_blocking(fn, *args, **kwargs):
    """Run a synchronous function in the thread pool and wait for it without blocking."""
    return await run_in_threadpool(functools.partial(fn, *args, **kwargs))


def _offloaded(fn):
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        if getattr(_local, "in_worker", False):
            return await fn(*args, **kwargs)

        def body():
            _local.in_worker = True
            try:
                return asyncio.run(fn(*args, **kwargs))
            finally:
                _local.in_worker = False

        return await run_in_threadpool(body)

    wrapper.__offloaded__ = True
    return wrapper


def offload_async_methods(cls):
    """Wrap every `async def` static/class/instance method of `cls` (see module docstring)."""
    for name, attr in list(vars(cls).items()):
        if isinstance(attr, staticmethod) and inspect.iscoroutinefunction(attr.__func__):
            setattr(cls, name, staticmethod(_offloaded(attr.__func__)))
        elif inspect.iscoroutinefunction(attr) and not name.startswith("__"):
            setattr(cls, name, _offloaded(attr))
    return cls
