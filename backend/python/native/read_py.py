"""
read_py — Lecture du contenu d'un fichier dans le workspace sandbox
"""
from pathlib import Path
from typing import Any, Dict
from ..core.function_context import FunctionContext
from ..core.file_utils import MAX_FILE_SIZE


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Lit le contenu d'un fichier dans le workspace sandbox.

    Args (JSON) :
        file_path (str)   : Chemin relatif au workspace
        start_line (int)  : Ligne de début 1-indexée (optionnel)
        end_line (int)    : Ligne de fin inclusive (optionnel)
        encoding (str)    : Encodage (défaut: utf-8)

    Returns :
        content (str), file_path (str), total_lines (int), lines_returned (int)
    """
    file_path: str = args.get("file_path", "")
    start_line: int | None = args.get("start_line")
    end_line: int | None = args.get("end_line")
    encoding: str = args.get("encoding", "utf-8")

    if not file_path:
        raise ValueError("file_path est requis")

    resolved = context.resolve_path(file_path)

    if not resolved.exists():
        raise FileNotFoundError(f"Fichier introuvable : {file_path}")
    if not resolved.is_file():
        raise ValueError(f"Le chemin n'est pas un fichier : {file_path}")

    # Vérification taille avant lecture en mémoire (protection OOM)
    file_size = resolved.stat().st_size
    if file_size > MAX_FILE_SIZE:
        raise ValueError(
            f"Fichier trop volumineux pour être lu en mémoire ({file_size} octets, max {MAX_FILE_SIZE}). "
            "Utilisez start_line/end_line pour lire par blocs."
        )

    # Détection des fichiers binaires et gestion d'encodage robuste
    raw_bytes = resolved.read_bytes()
    try:
        content = raw_bytes.decode(encoding)
    except UnicodeDecodeError:
        # Tentative de fallback latin-1 (décode tout sans erreur)
        try:
            content = raw_bytes.decode("latin-1")
            context.log(f"[read_py] Avertissement : fichier {file_path} lu en latin-1 (pas UTF-8)")
        except UnicodeDecodeError:
            raise ValueError(
                f"Impossible de décoder {file_path} (essais : {encoding}, latin-1). "
                "Le fichier est peut-être binaire."
            )

    lines = content.splitlines(keepends=True)
    total_lines = len(lines)

    # Sélection de plage de lignes
    if start_line is not None or end_line is not None:
        s = max(0, (start_line or 1) - 1)  # 0-indexed, borne inférieure sûre
        e = min(total_lines, end_line if end_line is not None else total_lines)
        selected_lines = lines[s:e]
        content = "".join(selected_lines)
        lines_returned = len(selected_lines)
    else:
        lines_returned = total_lines

    return {
        "content": content,
        "file_path": str(resolved.relative_to(context.workspace_dir)),
        "total_lines": total_lines,
        "lines_returned": lines_returned,
    }
