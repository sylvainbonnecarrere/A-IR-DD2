"""
multi_edit_py — Remplacements multiples atomiques sur un fichier du workspace sandbox
"""
from typing import Any, Dict, List
from core.function_context import FunctionContext
from core.file_utils import atomic_write_bytes


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Applique une liste ordonnée de remplacements sur un fichier de manière atomique.
    
    COMPORTEMENT :
    - Tous les remplacements sont validés AVANT toute écriture (pré-validation).
    - Si un remplacement est invalide (introuvable ou non-unique), AUCUNE modification
      n'est appliquée au fichier (transaction tout-ou-rien).
    - Si tous les remplacements sont valides, ils sont appliqués séquentiellement
      et le résultat est écrit atomiquement (temp file + rename).

    Args (JSON) :
        file_path (str) : Chemin relatif au workspace
        edits (list)    : [{"old_str": str, "new_str": str}, ...]

    Returns :
        success (bool), applied_edits (int), failed_edits (int), errors (list[str])
    """
    file_path: str = args.get("file_path", "")
    edits: List[Dict[str, str]] = args.get("edits", [])

    if not file_path:
        raise ValueError("file_path est requis")
    if not edits:
        raise ValueError("edits est requis et ne peut pas être vide")

    resolved = context.resolve_path(file_path)

    if not resolved.exists():
        raise FileNotFoundError(f"Fichier introuvable : {file_path}")

    # Lecture avec détection binaire
    raw_bytes = resolved.read_bytes()
    try:
        content = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return {
            "success": False,
            "applied_edits": 0,
            "failed_edits": len(edits),
            "errors": ["Fichier non UTF-8 — édition texte impossible sur un fichier binaire"],
        }

    # Phase 1 : Pré-validation de tous les edits sur le contenu simulé
    # Permet de détecter les conflits avant toute écriture
    simulated_content = content
    errors: List[str] = []

    for i, edit in enumerate(edits):
        old_str = edit.get("old_str", "")
        new_str = edit.get("new_str", "")

        if not old_str:
            errors.append(f"edit[{i}]: old_str est vide")
            continue

        count = simulated_content.count(old_str)
        if count == 0:
            errors.append(f"edit[{i}]: '{old_str[:60]}' introuvable dans le fichier (état après edits précédents)")
        elif count > 1:
            errors.append(f"edit[{i}]: '{old_str[:60]}' apparaît {count} fois — doit être unique")
        else:
            # Appliquer sur contenu simulé pour détecter les conflits en chaîne
            simulated_content = simulated_content.replace(old_str, new_str, 1)

    if errors:
        # Aucune écriture si un seul edit est invalide (transaction tout-ou-rien)
        return {
            "success": False,
            "applied_edits": 0,
            "failed_edits": len(errors),
            "errors": errors,
        }

    # Phase 2 : Écriture atomique du résultat final validé
    atomic_write_bytes(resolved, simulated_content.encode("utf-8"))

    return {
        "success": True,
        "applied_edits": len(edits),
        "failed_edits": 0,
        "errors": [],
    }
