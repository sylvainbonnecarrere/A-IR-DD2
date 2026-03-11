"""
file_utils — Utilitaires partagés sécurisés pour les opérations fichier
"""
import os
import tempfile
from pathlib import Path

# Limite de taille maximale des fichiers (50 MB)
MAX_FILE_SIZE: int = 50_000_000


def atomic_write_bytes(path: Path, content_bytes: bytes) -> None:
    """
    Écrit `content_bytes` dans `path` de manière atomique :
    - Écrit dans un fichier temporaire dans le même répertoire
    - Puis effectue os.replace() (atomique sur POSIX et Windows)
    
    Garantit qu'un crash mid-write ne corrompt jamais le fichier cible.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content_bytes)
        os.replace(tmp_path, path)
    except Exception:
        # Nettoyage en cas d'erreur
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
