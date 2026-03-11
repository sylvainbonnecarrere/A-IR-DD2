"""
edit_py — Remplacement ciblé d'une chaîne dans un fichier du workspace sandbox
"""
from pathlib import Path
from typing import Any, Dict
from ..core.function_context import FunctionContext
from ..core.file_utils import atomic_write_bytes


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Remplace une occurrence exacte de `old_str` par `new_str` dans un fichier.

    Args (JSON) :
        file_path (str) : Chemin relatif au workspace
        old_str (str)   : Chaîne exacte à remplacer (doit être unique dans le fichier)
        new_str (str)   : Nouveau contenu de remplacement

    Returns :
        success (bool), file_path (str), occurrences_replaced (int), message (str)
    """
    file_path: str = args.get("file_path", "")
    old_str: str = args.get("old_str", "")
    new_str: str = args.get("new_str", "")

    if not file_path:
        raise ValueError("file_path est requis")
    if not old_str:
        raise ValueError("old_str est requis et ne peut pas être vide")

    resolved = context.resolve_path(file_path)

    if not resolved.exists():
        raise FileNotFoundError(f"Fichier introuvable : {file_path}")

    # Lecture en mode binaire pour préserver les fins de ligne originales (CRLF vs LF)
    raw_bytes = resolved.read_bytes()
    try:
        content = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return {
            "success": False,
            "file_path": file_path,
            "occurrences_replaced": 0,
            "message": "Fichier non UTF-8 — édition texte impossible sur un fichier binaire",
        }

    count = content.count(old_str)

    if count == 0:
        return {
            "success": False,
            "file_path": file_path,
            "occurrences_replaced": 0,
            "message": "La chaîne old_str n'a pas été trouvée dans le fichier",
        }

    if count > 1:
        return {
            "success": False,
            "file_path": file_path,
            "occurrences_replaced": 0,
            "message": f"La chaîne old_str apparaît {count} fois — elle doit être unique pour éviter des remplacements involontaires",
        }

    new_content = content.replace(old_str, new_str, 1)
    # Écriture atomique : évite la corruption en cas de crash
    atomic_write_bytes(resolved, new_content.encode("utf-8"))

    return {
        "success": True,
        "file_path": str(resolved.relative_to(context.workspace_dir)),
        "occurrences_replaced": 1,
        "message": "Remplacement effectué avec succès",
    }
