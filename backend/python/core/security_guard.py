"""
SecurityGuard — Gardien de sécurité pour les opérations fichier sandbox

Prévient les attaques par traversal de chemin (path traversal / directory traversal).

Pattern : Guardrail / Policy Object
"""

from pathlib import Path


class SecurityGuard:
    """
    Valide que tous les chemins restent dans le répertoire de base autorisé.

    Exemple :
        guard = SecurityGuard(base_dir="/sandbox/workspace")
        guard.resolve_path("../../etc/passwd")  # → ValueError
        guard.resolve_path("output/result.json")  # → /sandbox/workspace/output/result.json
    """

    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir).resolve()

    def resolve_path(self, relative_path: str) -> Path:
        """
        Résout un chemin relatif et s'assure qu'il reste dans base_dir.

        Paramètres :
            relative_path (str) : Chemin relatif fourni par l'utilisateur/LLM.

        Retourne :
            Path : Chemin absolu résolu et validé.

        Lève :
            ValueError : Si le chemin sort du sandbox (tentative de traversal).
        """
        # Résoudre le chemin absolu sans suivre les symlinks
        resolved = (self.base_dir / relative_path).resolve()

        # Vérifier que le chemin résolu commence par base_dir
        try:
            resolved.relative_to(self.base_dir)
        except ValueError:
            raise ValueError(
                f"Accès refusé : le chemin '{relative_path}' "
                f"sort du répertoire autorisé '{self.base_dir}'"
            )

        return resolved
