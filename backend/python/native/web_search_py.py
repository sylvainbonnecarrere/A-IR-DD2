"""Compatibility wrapper preserving the historical native entrypoint."""

from pathlib import Path


_BASELINE_PATH = Path(__file__).with_name('web_search_py_old.py')
exec(compile(_BASELINE_PATH.read_text(encoding='utf-8'), str(_BASELINE_PATH), 'exec'), globals())
