"""
agent_py — Délégation d'une tâche à un sous-agent LLM

NOTE V1: Cette fonction est un stub — l'intégration complète avec les agents
          enregistrés sera disponible à Jalon J8 (AgentLoop + adapters LLM).
"""
from typing import Any, Dict
from ..core.function_context import FunctionContext


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Délègue une tâche à un sous-agent LLM.

    Args (JSON) :
        task (str)            : Description de la tâche à déléguer
        agent_name (str)      : Nom de l'agent cible
        context (str)         : Contexte supplémentaire (optionnel)
        max_iterations (int)  : Nombre max d'itérations (défaut: 5)

    Returns :
        result (str), iterations_used (int), agent_name (str)
    """
    task: str = args.get("task", "")
    agent_name: str = args.get("agent_name", "")
    extra_context: str = args.get("context", "")
    max_iterations: int = min(int(args.get("max_iterations", 5)), 20)

    if not task:
        raise ValueError("task est requis")
    if not agent_name:
        raise ValueError("agent_name est requis")

    # TODO J8: Intégrer avec AgentRegistry + AgentLoop
    # Pour l'instant, retourner un résultat stub documenté
    context.log(f"[agent_py] Stub V1 — délégation à '{agent_name}' non encore implémentée (J8)")

    return {
        "result": (
            f"[Stub V1] La délégation à l'agent '{agent_name}' sera disponible au Jalon J8. "
            f"Tâche reçue : {task[:200]}"
        ),
        "iterations_used": 0,
        "agent_name": agent_name,
    }
