"""
runner.py — Point d'entrée d'exécution sandbox pour les fonctions natives Phil (Tools V2)

Usage :
    python runner.py <function_name> '<json_args>'

Contrat :
    - Reçoit le nom de la fonction et les arguments JSON en argv
    - Instancie FunctionContext à partir des args
    - Délègue à la fonction native correspondante
    - Imprime le résultat JSON sur stdout
    - Toute erreur → stderr, exit code 1

Sécurité :
    - Répertoire sandbox isolé via SANDBOX_WORKSPACE_DIR env var
    - Timeout global géré par le processus parent (SandboxService)
    - Fonctions disponibles déclarées dans FUNCTION_REGISTRY (whitelist explicite)
"""

import sys
import json
import os
import traceback
from pathlib import Path

# Ajouter le répertoire courant au path Python
sys.path.insert(0, str(Path(__file__).parent))

from core.function_context import FunctionContext
from core.security_guard import SecurityGuard

# ─── Registre des fonctions natives ──────────────────────────────────────────
# Whitelist explicite — évite toute exécution de fonctions inattendues
from native.agent_py import run as agent_py_run
from native.bash_py import run as bash_py_run
from native.edit_py import run as edit_py_run
from native.ls_py import run as ls_py_run
from native.multi_edit_py import run as multi_edit_py_run
from native.read_py import run as read_py_run
from native.todo_read_py import run as todo_read_py_run
from native.todo_write_py import run as todo_write_py_run
from native.web_fetch_py import run as web_fetch_py_run
from native.web_search_py import run as web_search_py_run
from native.write_py import run as write_py_run

FUNCTION_REGISTRY = {
    "agent_py": agent_py_run,
    "bash_py": bash_py_run,
    "edit_py": edit_py_run,
    "ls_py": ls_py_run,
    "multi_edit_py": multi_edit_py_run,
    "read_py": read_py_run,
    "todo_read_py": todo_read_py_run,
    "todo_write_py": todo_write_py_run,
    "web_fetch_py": web_fetch_py_run,
    "web_search_py": web_search_py_run,
    "write_py": write_py_run,
}

# ─── Point d'entrée ──────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 3:
        print(
            json.dumps({"error": "Usage: python runner.py <function_name> '<json_args>'"}),
            file=sys.stderr
        )
        sys.exit(1)

    function_name = sys.argv[1]
    args_json = sys.argv[2]

    # Valider le nom de la fonction (whitelist)
    if function_name not in FUNCTION_REGISTRY:
        print(
            json.dumps({"error": f"Fonction '{function_name}' non trouvée dans le registre"}),
            file=sys.stderr
        )
        sys.exit(1)

    # Parser les arguments JSON
    try:
        args = json.loads(args_json)
        if not isinstance(args, dict):
            raise ValueError("Les arguments doivent être un objet JSON")
    except (json.JSONDecodeError, ValueError) as e:
        print(
            json.dumps({"error": f"Arguments JSON invalides: {str(e)}"}),
            file=sys.stderr
        )
        sys.exit(1)

    # Construire le contexte d'exécution
    workspace_dir = os.environ.get("SANDBOX_WORKSPACE_DIR", "/sandbox/workspace")
    context = FunctionContext(
        workspace_dir=workspace_dir,
        function_name=function_name
    )

    # Exécuter la fonction
    try:
        func = FUNCTION_REGISTRY[function_name]
        result = func(context, args)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(
            json.dumps({
                "error": str(e),
                "traceback": traceback.format_exc()
            }),
            file=sys.stderr
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
