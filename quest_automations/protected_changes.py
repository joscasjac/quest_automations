"""Server-only write authority cannot be supplied through a document's JSON flags."""
from contextlib import contextmanager
from contextvars import ContextVar

_internal_change = ContextVar('quest_internal_change', default=False)

def is_internal_change():
    return _internal_change.get()

@contextmanager
def internal_change():
    token = _internal_change.set(True)
    try:
        yield
    finally:
        _internal_change.reset(token)
