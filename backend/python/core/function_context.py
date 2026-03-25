"""
FunctionContext — Contexte d'exécution sécurisé pour les fonctions natives Phil

Fourni par le runner.py à chaque appel de fonction.
Donne accès au workspace sandboxé et à des helpers utilitaires.

Sécurité :
    - Toutes les opérations fichier passent par SecurityGuard.resolve_path()
    - Aucun accès en-dehors de workspace_dir n'est autorisé
"""

import os
from pathlib import Path
from .security_guard import SecurityGuard


class FunctionContext:
    """
    Contexte d'exécution transmis à chaque fonction native.

    Attributs :
        workspace_dir (str)  : Répertoire racine du sandbox (ex: /sandbox/workspace)
        function_name (str)  : Nom de la fonction en cours d'exécution (logging)
        guard (SecurityGuard): Validateur de chemins anti-traversal
    """

    def __init__(self, workspace_dir: str, function_name: str):
        self.workspace_dir = Path(workspace_dir).resolve()
        self.function_name = function_name
        self.guard = SecurityGuard(base_dir=self.workspace_dir)

        # Créer le répertoire workspace s'il n'existe pas
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def resolve_path(self, relative_path: str) -> Path:
        """
        Résout un chemin relatif au workspace et vérifie qu'il reste dans le sandbox.

        Lève ValueError si le chemin sort du workspace (path traversal).
        """
        return self.guard.resolve_path(relative_path)

    def workspace_path(self, *parts: str) -> Path:
        """Construit un chemin absolu dans le workspace à partir de segments."""
        return self.resolve_path(os.path.join(*parts))

    def log(self, message: str) -> None:
        """Log vers stderr (ne pollue pas le stdout réservé au résultat JSON)."""
        import sys
        print(f"[{self.function_name}] {message}", file=sys.stderr)
