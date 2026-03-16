/**
 * SandboxHealthLoader — Indicateur de santé du sandbox Python (C9.2)
 *
 * Interroge GET /api/sandbox/health à l'initialisation de la page Phil/Functions.
 * Affiche un badge d'état compact dans le header sans bloquer l'affichage.
 *
 * États visuels :
 *   🟡 Vérification en cours — spinner cyan
 *   🟢 Python disponible — version + exécutable
 *   🔴 Python non détecté — message + lien vers aide
 */

import React, { useEffect, useState } from 'react';
import { getBackendUrl } from '../config/api.config';
import { useAuth } from '../contexts/AuthContext';

interface SandboxHealth {
    python: { available: boolean; version?: string; executable: string };
    typescript: { available: boolean };
}

export const SandboxHealthLoader: React.FC = () => {
    const { accessToken, isAuthenticated } = useAuth();
    const [health, setHealth] = useState<SandboxHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);

    useEffect(() => {
        if (!isAuthenticated || !accessToken) {
            setLoading(false);
            return;
        }

        let cancelled = false;

        fetch(`${getBackendUrl()}/api/sandbox/health`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((data: SandboxHealth) => {
                if (!cancelled) {
                    setHealth(data);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFetchError(true);
                    setLoading(false);
                }
            });

        return () => { cancelled = true; };
    }, [accessToken, isAuthenticated]);

    if (!isAuthenticated) return null;

    if (loading) {
        return (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <div className="w-3 h-3 border border-gray-500/40 border-t-cyan-400 rounded-full animate-spin flex-shrink-0" />
                <span>Vérification sandbox…</span>
            </div>
        );
    }

    if (fetchError || !health?.python.available) {
        return (
            <div
                className="flex items-center gap-1.5 text-xs text-red-400"
                title="Python non détecté — L'exécution sandbox est désactivée. Installez Python 3 et redémarrez le backend."
            >
                <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                <span>Python non détecté — sandbox désactivé</span>
            </div>
        );
    }

    const versionShort = health.python.version?.replace(/^Python\s+/i, '') ?? '';

    return (
        <div
            className="flex items-center gap-1.5 text-xs text-emerald-400"
            title={`Sandbox Python prêt — ${health.python.version} (${health.python.executable})`}
        >
            <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            <span>Sandbox prêt <span className="text-emerald-500/70">({versionShort})</span></span>
        </div>
    );
};

export default SandboxHealthLoader;
