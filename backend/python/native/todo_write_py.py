"""
todo_write_py — Écriture/modification de la liste TODO de la session sandbox
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List
from core.function_context import FunctionContext

TODO_FILE = ".todo.json"


def _load_todos(context: FunctionContext) -> List[Dict[str, Any]]:
    todo_path = context.workspace_dir / TODO_FILE
    if not todo_path.exists():
        return []
    try:
        return json.loads(todo_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError):
        return []


def _save_todos(context: FunctionContext, todos: List[Dict[str, Any]]) -> None:
    todo_path = context.workspace_dir / TODO_FILE
    todo_path.write_text(json.dumps(todos, ensure_ascii=False, indent=2), encoding="utf-8")


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Crée, met à jour ou supprime des tâches TODO.

    Args (JSON) :
        action (str) : 'create' | 'update' | 'delete' | 'clear_completed'
        todo (obj)   :
            id (str)       — requis pour update/delete
            content (str)  — requis pour create
            status (str)   — 'pending' | 'in_progress' | 'completed'
            priority (str) — 'high' | 'medium' | 'low' (défaut: 'medium')

    Returns :
        success (bool), action (str), todo_id (str | null), message (str)
    """
    action: str = args.get("action", "")
    todo_data: Dict[str, Any] = args.get("todo", {})

    if not action:
        raise ValueError("action est requis ('create' | 'update' | 'delete' | 'clear_completed')")

    todos = _load_todos(context)

    if action == "create":
        content = todo_data.get("content", "")
        if not content:
            raise ValueError("todo.content est requis pour l'action 'create'")

        new_todo: Dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "content": content,
            "status": todo_data.get("status", "pending"),
            "priority": todo_data.get("priority", "medium"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        todos.append(new_todo)
        _save_todos(context, todos)
        return {"success": True, "action": "create", "todo_id": new_todo["id"], "message": "Tâche créée"}

    elif action == "update":
        todo_id = todo_data.get("id", "")
        if not todo_id:
            raise ValueError("todo.id est requis pour l'action 'update'")

        found = False
        for t in todos:
            if t["id"] == todo_id:
                if "content" in todo_data:
                    t["content"] = todo_data["content"]
                if "status" in todo_data:
                    t["status"] = todo_data["status"]
                if "priority" in todo_data:
                    t["priority"] = todo_data["priority"]
                t["updated_at"] = datetime.now(timezone.utc).isoformat()
                found = True
                break

        if not found:
            return {"success": False, "action": "update", "todo_id": todo_id, "message": f"Tâche {todo_id} introuvable"}

        _save_todos(context, todos)
        return {"success": True, "action": "update", "todo_id": todo_id, "message": "Tâche mise à jour"}

    elif action == "delete":
        todo_id = todo_data.get("id", "")
        if not todo_id:
            raise ValueError("todo.id est requis pour l'action 'delete'")

        new_todos = [t for t in todos if t["id"] != todo_id]
        if len(new_todos) == len(todos):
            return {"success": False, "action": "delete", "todo_id": todo_id, "message": f"Tâche {todo_id} introuvable"}

        _save_todos(context, new_todos)
        return {"success": True, "action": "delete", "todo_id": todo_id, "message": "Tâche supprimée"}

    elif action == "clear_completed":
        new_todos = [t for t in todos if t.get("status") != "completed"]
        removed = len(todos) - len(new_todos)
        _save_todos(context, new_todos)
        return {"success": True, "action": "clear_completed", "todo_id": None, "message": f"{removed} tâche(s) complétée(s) supprimée(s)"}

    else:
        raise ValueError(f"Action inconnue : '{action}'. Valeurs valides : create, update, delete, clear_completed")
