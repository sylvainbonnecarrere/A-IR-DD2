"""
bash_py — Exécution de commandes shell dans un environnement Docker sandboxé
DÉSACTIVÉ par défaut (isEnabled: false dans la BDD)

SÉCURITÉ : Cette fonction ne doit s'exécuter QUE dans un conteneur Docker isolé.
           Ne jamais l'activer en environnement de développement non-sandboxé.
"""
import subprocess
import os
from typing import Any, Dict
from core.function_context import FunctionContext
from core.command_validator import validate_command


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Exécute une commande shell dans le workspace sandbox.

    Args (JSON) :
        command (str)   : Commande à exécuter
        cwd (str)       : Répertoire de travail (défaut: workspace_dir)
        timeout (int)   : Timeout en secondes (max: 30, défaut: 10)
        env (dict)      : Variables d'environnement supplémentaires

    Returns :
        stdout (str), stderr (str), exit_code (int), timed_out (bool)
    """
    # Vérification que nous sommes bien dans un environnement sandbox
    if not os.environ.get("SANDBOX_ENVIRONMENT"):
        raise RuntimeError(
            "bash_py ne peut s'exécuter que dans un environnement sandbox Docker "
            "(variable SANDBOX_ENVIRONMENT non définie). "
            "Cette fonction est désactivée en dehors du sandbox."
        )

    command: str = args.get("command", "")
    cwd: str = args.get("cwd", str(context.workspace_dir))
    timeout: int = min(int(args.get("timeout", 10)), 30)
    extra_env: dict = args.get("env", {})

    if not command:
        raise ValueError("command est requis")

    # Validation de extra_env : rejeter les clés/valeurs non-string ou suspectes
    # Empêche l'injection via HTTP_PROXY, LD_PRELOAD, etc.
    _BLOCKED_ENV_KEYS = {"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
                         "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
                         "PATH", "PYTHONPATH", "NODE_PATH"}
    if not isinstance(extra_env, dict):
        raise ValueError("env doit être un objet clé-valeur")
    for k, v in extra_env.items():
        if not isinstance(k, str) or not isinstance(v, str):
            raise ValueError(f"env[{k!r}] : clé et valeur doivent être des chaînes")
        if k in _BLOCKED_ENV_KEYS:
            raise PermissionError(f"Variable d'environnement '{k}' non autorisée pour des raisons de sécurité")

    # Validation par whitelist stricte (remplace l'ancienne blacklist)
    is_safe, reason = validate_command(command)
    if not is_safe:
        raise PermissionError(f"Commande refusée (sécurité) : {reason}")

    # Valider que cwd reste dans le workspace
    context.resolve_path(os.path.relpath(cwd, str(context.workspace_dir)) if os.path.isabs(cwd) else cwd)

    env = {**os.environ, **extra_env}
    timed_out = False

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env
        )
        # Limite la taille des sorties pour éviter les attaques par saturation mémoire
        _MAX_OUTPUT = 10_000_000  # 10 MB
        stdout = result.stdout[:_MAX_OUTPUT]
        stderr = result.stderr[:_MAX_OUTPUT]
        output_truncated = len(result.stdout) > _MAX_OUTPUT or len(result.stderr) > _MAX_OUTPUT
        return {
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": result.returncode,
            "timed_out": False,
            "output_truncated": output_truncated,
        }
    except subprocess.TimeoutExpired:
        return {
            "stdout": "",
            "stderr": f"Timeout : la commande a dépassé {timeout} secondes",
            "exit_code": -1,
            "timed_out": True,
            "output_truncated": False,
        }
