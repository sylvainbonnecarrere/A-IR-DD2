/**
 * SandboxHealthLoader — Indicateur de readiness du runtime MVP.
 *
 * Interroge GET /api/sandbox/health à l'initialisation de la page Phil/Functions.
 * Affiche un badge d'état compact dans le header sans bloquer l'affichage.
 *
 * États visuels :
 *   🟡 Vérification en cours — spinner cyan
 *   🟢 Python disponible — version + exécutable
 *   🔴 Python non détecté — message + lien vers aide
 */

import React, { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useFunctionStore } from '../stores/useFunctionStore';
import type { RuntimeHealthReport } from '../types/function.types';

function buildNativePythonBadge(runtimeHealth: RuntimeHealthReport): {
    label: string;
    detail: string;
    toneClass: string;
} | null {
    const nativePythonHealth = runtimeHealth.nativePython;
    if (!nativePythonHealth) {
        return null;
    }

    if (nativePythonHealth.status === 'healthy') {
        return {
            label: 'imports natifs OK',
            detail: nativePythonHealth.summary,
            toneClass: 'text-emerald-500/70'
        };
    }

    const failingTools = nativePythonHealth.probes
        .filter((probe) => probe.status !== 'healthy')
        .map((probe) => probe.toolName);

    return {
        label: failingTools.length > 0
            ? `imports natifs a verifier: ${failingTools.join(', ')}`
            : 'imports natifs a verifier',
        detail: nativePythonHealth.summary,
        toneClass: 'text-amber-500/70'
    };
}

export const SandboxHealthLoader: React.FC = () => {
    const { accessToken, isAuthenticated } = useAuth();
    const {
        runtimeHealth,
        isRuntimeHealthLoading,
        runtimeHealthError,
        loadRuntimeHealth,
    } = useFunctionStore();

    useEffect(() => {
        if (!isAuthenticated || !accessToken) {
            return;
        }

        void loadRuntimeHealth();
    }, [accessToken, isAuthenticated, loadRuntimeHealth]);

    if (!isAuthenticated) return null;

    if (isRuntimeHealthLoading && !runtimeHealth) {
        return (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <div className="w-3 h-3 border border-gray-500/40 border-t-cyan-400 rounded-full animate-spin flex-shrink-0" />
                <span>Vérification runtime…</span>
            </div>
        );
    }

    if (runtimeHealthError || !runtimeHealth) {
        return (
            <div
                className="flex items-center gap-1.5 text-xs text-red-400"
                title={runtimeHealthError || 'Échec de lecture de l\'état runtime.'}
            >
                <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                <span>Runtime indisponible</span>
            </div>
        );
    }

    const pythonVersionShort = runtimeHealth.python.version?.replace(/^Python\s+/i, '') ?? '';
    const canRunPython = runtimeHealth.capabilities.run.python;
    const canRunTypescript = runtimeHealth.capabilities.run.typescript;
    const dockerMode = runtimeHealth.runtime.docker.mode;
    const isDevOnly = runtimeHealth.runtime.docker.securityLevel === 'dev-only';
    const nativePythonBadge = buildNativePythonBadge(runtimeHealth);
    const runtimeModeLabel = dockerMode === 'rootless'
        ? 'rootless'
        : dockerMode === 'docker-desktop'
            ? 'Docker Desktop'
            : dockerMode === 'rootful-linux'
                ? 'Docker rootful'
                : 'mode inconnu';

    if (runtimeHealth.status === 'healthy') {
        return (
            <div
                className="flex items-center gap-1.5 text-xs text-emerald-400"
                title={`Runtime prêt — ${runtimeHealth.summary}${nativePythonBadge ? ` — ${nativePythonBadge.detail}` : ''}`}
            >
                <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span>
                    Runtime prêt <span className="text-emerald-500/70">({pythonVersionShort || 'Python OK'} · {runtimeModeLabel})</span>
                    {nativePythonBadge && <span className={`ml-1 ${nativePythonBadge.toneClass}`}>· {nativePythonBadge.label}</span>}
                </span>
            </div>
        );
    }

    if (runtimeHealth.status === 'degraded') {
        return (
            <div
                className="flex items-center gap-1.5 text-xs text-amber-300"
                title={`${runtimeHealth.summary}${nativePythonBadge ? ` — ${nativePythonBadge.detail}` : ''}`}
            >
                <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                <span>{isDevOnly ? 'Runtime dev/test (dev-only)' : 'Runtime partiel'}</span>
                <span className="text-amber-500/70">({canRunPython || canRunTypescript ? runtimeModeLabel : 'build seulement'})</span>
                {nativePythonBadge && <span className={`truncate ${nativePythonBadge.toneClass}`}>· {nativePythonBadge.label}</span>}
            </div>
        );
    }

    return (
        <div
            className="flex items-center gap-1.5 text-xs text-red-400"
            title={runtimeHealth.summary}
        >
            <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            <span>Run bloqué <span className="text-red-500/70">(runtime non prêt)</span></span>
        </div>
    );
};

export default SandboxHealthLoader;
