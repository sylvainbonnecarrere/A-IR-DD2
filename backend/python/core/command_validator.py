"""
command_validator — Validation par whitelist des commandes shell pour bash_py

Approche Conservative (Approche A) :
- Seules les commandes explicitement listées dans SAFE_COMMANDS sont autorisées.
- shlex.split() tokenise la commande pour éviter les contournements par encodage.
- BLOCKED_CONSTRUCTS détecte les constructions de shell dangereuses.
"""
import shlex
from typing import Tuple

# Commandes autorisées explicitement
SAFE_COMMANDS = {
    # Filesystem / navigation
    "ls", "pwd", "find", "cat", "head", "tail", "echo", "stat",
    # Recherche / filtrage
    "grep", "sort", "uniq", "wc", "sed", "awk", "cut",
    # Outils de développement
    "git", "npm", "npx", "python3", "python", "pip", "pip3",
    "node", "cargo", "ruby", "java",
    # Réseau (lecture seule)
    "curl", "wget", "ping", "dig", "nslookup",
    # Outils systèmes non-destructifs
    "env", "which", "type", "date", "uptime", "df", "du",
    # Compression / archivage (lecture)
    "tar", "unzip", "zip",
}

# Constructions shell qui permettent l'enchaînement ou la redirection dangereuse
BLOCKED_CONSTRUCTS = {
    ";",        # Enchaînement de commandes
    "&&",       # Enchaînement conditionnel
    "||",       # Enchaînement conditionnel
    "|",        # Pipe (peut chaîner des commandes arbitraires)
    "`",        # Substitution de commande (backtick)
    "$(",       # Substitution de commande (dollar-paren)
    "${",       # Expansion de variable (forme brace)
    "&",        # Exécution en arrière-plan
    ">>",       # Redirection (append)
    ">",        # Redirection (écrasement)
    "<(",       # Process substitution
    ">(",       # Process substitution
}


def validate_command(command: str) -> Tuple[bool, str]:
    """
    Valide une commande shell par whitelist stricte.

    Args:
        command: La commande brute fournie par l'utilisateur.

    Returns:
        Tuple (is_safe: bool, reason: str)
        - is_safe=True si la commande est autorisée
        - is_safe=False avec le motif de refus sinon
    """
    if not command or not command.strip():
        return False, "Commande vide"

    # Vérification pré-tokenisation des constructions bloquées dans la chaîne brute
    # (pour attraper celles qui survivent à shlex, comme $(...) ou `cmd`)
    for construct in BLOCKED_CONSTRUCTS:
        if construct in command:
            return False, f"Construction shell interdite '{construct}' détectée"

    # Tokenisation sécurisée via shlex (gère les guillemets correctement)
    try:
        tokens = shlex.split(command)
    except ValueError as e:
        return False, f"Erreur de parsing de la commande : {e}"

    if not tokens:
        return False, "Commande vide après parsing"

    # Extraire le nom de base de la commande (ignorer le chemin absolu)
    base_cmd = tokens[0].split("/")[-1].split("\\")[-1]

    if base_cmd not in SAFE_COMMANDS:
        return False, (
            f"Commande '{base_cmd}' non autorisée. "
            f"Seules les commandes de la whitelist sont acceptées dans le sandbox."
        )

    # Vérifier chaque token pour détecter des constructions injectées
    for token in tokens[1:]:
        for construct in BLOCKED_CONSTRUCTS:
            if construct in token:
                return False, f"Construction shell interdite '{construct}' dans l'argument : {token!r}"

    return True, "OK"
