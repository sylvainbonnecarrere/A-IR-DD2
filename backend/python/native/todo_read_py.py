"""
todo_read_py — Lecture de la liste TODO de la session sandbox
"""
import json
import os
from typing import Any, Dict, List
from core.function_context import FunctionContext

TODO_FILE = ".todo.json"


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Lit la liste des tâches TODO de la session courante.

    Args (JSON) :
        filter_status (str)   : 'all' | 'pending' | 'in_progress' | 'completed' (défaut: 'all')
        filter_priority (str) : 'all' | 'high' | 'medium' | 'low' (défaut: 'all')

    Returns :
        todos (list), total (int)
    """
    filter_status: str = args.get("filter_status", "all")
    filter_priority: str = args.get("filter_priority", "all")

    todo_path = context.workspace_dir / TODO_FILE
    todos: List[Dict[str, Any]] = []

    if todo_path.exists():
        try:
            todos = json.loads(todo_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            todos = []

    # Filtrage
    if filter_status != "all":
        todos = [t for t in todos if t.get("status") == filter_status]
    if filter_priority != "all":
        todos = [t for t in todos if t.get("priority") == filter_priority]

    return {
        "todos": todos,
        "total": len(todos),
    }
