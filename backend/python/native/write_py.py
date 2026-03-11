"""
write_py — Création/écriture d'un fichier dans le workspace sandbox
"""
from pathlib import Path
from typing import Any, Dict
from ..core.function_context import FunctionContext
from ..core.file_utils import MAX_FILE_SIZE, atomic_write_bytes


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Crée ou écrase un fichier dans le workspace sandbox.

    Args (JSON) :
        file_path (str)   : Chemin relatif au workspace
        content (str)     : Contenu à écrire
        encoding (str)    : Encodage (défaut: utf-8)
        overwrite (bool)  : Écraser si existant (défaut: true)
        create_dirs (bool): Créer les parents si manquants (défaut: true)

    Returns :
        success (bool), file_path (str), bytes_written (int), created (bool)
    """
    file_path: str = args.get("file_path", "")
    content: str = args.get("content", "")
    encoding: str = args.get("encoding", "utf-8")
    overwrite: bool = args.get("overwrite", True)
    create_dirs: bool = args.get("create_dirs", True)

    if not file_path:
        raise ValueError("file_path est requis")

    resolved = context.resolve_path(file_path)
    created = not resolved.exists()

    if resolved.exists() and not overwrite:
        raise PermissionError(f"Le fichier existe déjà et overwrite=false : {file_path}")

    if create_dirs:
        resolved.parent.mkdir(parents=True, exist_ok=True)

    encoded = content.encode(encoding)

    # Limite de taille pour prévenir les attaques par saturation disque
    if len(encoded) > MAX_FILE_SIZE:
        raise ValueError(f"Contenu trop volumineux ({len(encoded)} octets, max {MAX_FILE_SIZE})")

    # Écriture atomique : évite la corruption en cas de crash
    atomic_write_bytes(resolved, encoded)

    return {
        "success": True,
        "file_path": str(resolved.relative_to(context.workspace_dir)),
        "bytes_written": len(encoded),
        "created": created,
    }
