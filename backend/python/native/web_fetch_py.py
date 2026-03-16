"""
web_fetch_py — Récupération sécurisée du contenu d'une URL (HTTPS uniquement)
"""
import re
from typing import Any, Dict
from core.function_context import FunctionContext

try:
    import requests
    from bs4 import BeautifulSoup
    _DEPS_OK = True
except ImportError:
    _DEPS_OK = False


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Récupère le contenu d'une URL.

    Args (JSON) :
        url (str)                 : URL cible (HTTPS uniquement)
        extract_text (bool)       : Extraire le texte brut HTML (défaut: true)
        timeout (int)             : Timeout en secondes (défaut: 10)
        headers (dict)            : En-têtes HTTP supplémentaires (optionnel)
        max_content_length (int)  : Longueur max retournée en caractères (défaut: 50000)

    Returns :
        content (str), status_code (int), url (str), title (str), content_type (str), truncated (bool)
    """
    if not _DEPS_OK:
        raise ImportError("Dépendances manquantes : pip install requests beautifulsoup4 lxml")

    url: str = args.get("url", "")
    extract_text: bool = args.get("extract_text", True)
    timeout: int = min(int(args.get("timeout", 10)), 30)
    extra_headers: dict = args.get("headers", {})
    max_len: int = int(args.get("max_content_length", 50_000))

    if not url:
        raise ValueError("url est requis")

    # Sécurité : HTTPS uniquement, pas d'URLs internes (SSRF prévention)
    if not url.startswith("https://"):
        raise ValueError("Seules les URLs HTTPS sont autorisées (sécurité)")

    # Bloquer les adresses internes connues (SSRF basique)
    _BLOCKED_PATTERNS = [
        r"localhost", r"127\.", r"0\.0\.0\.0", r"192\.168\.", r"10\.",
        r"172\.(1[6-9]|2[0-9]|3[01])\.", r"::1", r"metadata\.google",
        r"169\.254\.",   # AWS/GCP/Azure instance metadata endpoint
        r"fc00:", r"fe80:"  # IPv6 private/link-local ranges
    ]
    for pattern in _BLOCKED_PATTERNS:
        if re.search(pattern, url, re.IGNORECASE):
            raise ValueError(f"URL bloquée pour des raisons de sécurité (adresse interne ou métadonnées)")

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AITestBot/1.0)",
        **extra_headers
    }

    # allow_redirects=False : empêche le SSRF par redirect vers des addresses internes
    # (ex. https://attacker.com → redirect → http://localhost:6379)
    response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=False)

    # Si redirect, vérifier la destination avant de suivre
    if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
        redirect_url = response.headers.get("Location", "")
        if redirect_url:
            for pattern in _BLOCKED_PATTERNS:
                if re.search(pattern, redirect_url, re.IGNORECASE):
                    raise ValueError("Redirect vers une adresse interne bloquée (SSRF prévention)")
            if redirect_url.startswith("https://"):
                response = requests.get(redirect_url, headers=headers, timeout=timeout, allow_redirects=False)
            else:
                raise ValueError("Redirect non-HTTPS refusé (sécurité)")

    # Vérification Content-Length avant lecture en mémoire (protection OOM)
    content_length_header = response.headers.get("Content-Length", "")
    if content_length_header:
        try:
            declared_size = int(content_length_header)
            if declared_size > 10_000_000:  # 10 MB
                raise ValueError(f"Contenu trop volumineux ({declared_size} octets, max 10 MB)")
        except (ValueError, TypeError):
            pass  # Header mal formé — on continue avec truncation

    content_type: str = response.headers.get("content-type", "")

    raw_text = response.text
    title = ""

    if extract_text and "html" in content_type.lower():
        soup = BeautifulSoup(raw_text, "lxml")
        # Extraire le titre
        title_tag = soup.find("title")
        if title_tag:
            title = title_tag.get_text(strip=True)

        # Supprimer scripts, styles, nav, footer
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        content = soup.get_text(separator="\n", strip=True)
        # Normaliser les lignes vides
        content = re.sub(r"\n{3,}", "\n\n", content)
    else:
        content = raw_text

    truncated = len(content) > max_len
    if truncated:
        content = content[:max_len]

    return {
        "content": content,
        "status_code": response.status_code,
        "url": response.url,
        "title": title,
        "content_type": content_type,
        "truncated": truncated,
    }
