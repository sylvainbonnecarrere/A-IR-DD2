"""
ls_py — Listing du contenu d'un répertoire dans le workspace sandbox
"""
import os
import fnmatch
from pathlib import Path
from typing import Any, Dict, List
from core.function_context import FunctionContext


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Liste le contenu d'un répertoire dans le workspace.

    Args (JSON) :
        directory_path (str) : Chemin relatif au workspace
        recursive (bool)     : Récursif (défaut: false)
        show_hidden (bool)   : Inclure fichiers cachés (défaut: false)
        filter_pattern (str) : Glob de filtrage (ex: '*.py') (optionnel)

    Returns :
        entries (list), total_files (int), total_dirs (int)
    """
    directory_path: str = args.get("directory_path", ".")
    recursive: bool = args.get("recursive", False)
    show_hidden: bool = args.get("show_hidden", False)
    filter_pattern: str | None = args.get("filter_pattern")
    max_results: int = min(int(args.get("max_results", 1000)), 10_000)

    resolved = context.resolve_path(directory_path)

    if not resolved.exists():
        raise FileNotFoundError(f"Répertoire introuvable : {directory_path}")
    if not resolved.is_dir():
        raise ValueError(f"Le chemin n'est pas un répertoire : {directory_path}")

    entries: List[Dict[str, Any]] = []
    total_files = 0
    total_dirs = 0

    def _collect(path: Path, depth: int = 0):
        nonlocal total_files, total_dirs
        try:
            children = list(path.iterdir())
        except PermissionError:
            return

        for child in sorted(children, key=lambda p: (p.is_file(), p.name)):
            if not show_hidden and child.name.startswith("."):
                continue

            if filter_pattern and child.is_file():
                if not fnmatch.fnmatch(child.name, filter_pattern):
                    continue

            stat = child.stat()
            entry: Dict[str, Any] = {
                "name": child.name,
                "type": "file" if child.is_file() else "directory",
                "size": stat.st_size if child.is_file() else 0,
                "modified_at": str(int(stat.st_mtime)),
            }

            if depth > 0:
                rel = child.relative_to(resolved)
                entry["relative_path"] = str(rel).replace("\\", "/")

            entries.append(entry)

            if child.is_file():
                total_files += 1
            else:
                total_dirs += 1
                if recursive:
                    _collect(child, depth + 1)

            if len(entries) >= max_results:
                return

    _collect(resolved)

    return {
        "entries": entries,
        "total_files": total_files,
        "total_dirs": total_dirs,
        "truncated": len(entries) >= max_results,
    }
