import React, { useState } from 'react';
import { LocalLLMProfile } from '../../types';
import { ToggleSwitch } from '../UI';
import { TrashIcon } from '../Icons';
import { API_BASE_URL } from '../../config/api.config';
import { useAuth } from '../../hooks/useAuth';

interface LocalLLMProfileCardProps {
    profile: LocalLLMProfile;
    onChange: (updated: LocalLLMProfile) => void;
    onDelete: () => void;
}

export const LocalLLMProfileCard: React.FC<LocalLLMProfileCardProps> = ({
    profile,
    onChange,
    onDelete
}) => {
    const { accessToken } = useAuth();
    const [isDetecting, setIsDetecting] = useState(false);
    const [detectionError, setDetectionError] = useState<string | null>(null);
    const [detectionProgress, setDetectionProgress] = useState(0);
    const [detectionResult, setDetectionResult] = useState<{ modelId: string; capabilities: string[]; detectedAt: string } | null>(null);

    const handleFieldChange = (field: keyof LocalLLMProfile, value: any) => {
        onChange({ ...profile, [field]: value });
    };

    const handleCapabilityToggle = (cap: string, enabled: boolean) => {
        onChange({
            ...profile,
            capabilities: { ...profile.capabilities, [cap]: enabled }
        });
    };

    const handleDetect = async () => {
        if (!profile.endpoint) {
            setDetectionError('Veuillez entrer un endpoint');
            return;
        }

        setIsDetecting(true);
        setDetectionError(null);
        setDetectionProgress(0);
        setDetectionResult(null); // Reset stale result before each new detection

        let progressInterval: ReturnType<typeof setInterval> | null = null;
        try {
            progressInterval = setInterval(() => {
                setDetectionProgress(prev => Math.min(prev + 15, 90));
            }, 200);

            const apiUrl = `${API_BASE_URL}/api/local-llm/detect-capabilities?endpoint=${encodeURIComponent(profile.endpoint)}`;
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
                },
                signal: AbortSignal.timeout(15000)
            });

            const result = await response.json();
            clearInterval(progressInterval);
            progressInterval = null;
            setDetectionProgress(100);

            if (!result.healthy) {
                setDetectionError(result.error || 'Endpoint non accessible');
                setDetectionProgress(0);
                return;
            }

            // Update capabilities AND detectedModel from detection result
            const newCapabilities: Record<string, boolean> = { ...profile.capabilities };
            (result.capabilities as string[]).forEach(cap => {
                newCapabilities[cap] = true;
            });

            onChange({
                ...profile,
                capabilities: newCapabilities as LocalLLMProfile['capabilities'],
                detectedModel: result.modelId || undefined
            });

            // Store detection result for report display
            setDetectionResult({
                modelId: result.modelId || 'Modèle local',
                capabilities: result.capabilities || [],
                detectedAt: result.detectedAt || new Date().toISOString()
            });

            setTimeout(() => setDetectionProgress(0), 1000);
        } catch (error: any) {
            setDetectionError(error.message || 'Erreur lors de la détection');
            setDetectionProgress(0);
        } finally {
            if (progressInterval) clearInterval(progressInterval); // Ensure cleanup on any throw
            setIsDetecting(false);
        }
    };

    return (
        <div className="border border-gray-600 rounded-lg p-4 space-y-3 bg-gray-750">
            {/* Header row: name + delete */}
            <div className="flex items-center justify-between gap-2">
                <input
                    type="text"
                    value={profile.name}
                    onChange={e => handleFieldChange('name', e.target.value)}
                    placeholder="ex: Ollama - Code"
                    className="flex-1 p-2 text-sm bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-200"
                />
                <ToggleSwitch
                    checked={profile.enabled}
                    onChange={checked => handleFieldChange('enabled', checked)}
                />
                <button
                    onClick={onDelete}
                    className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                    title="Supprimer ce profil"
                >
                    <TrashIcon width={16} height={16} />
                </button>
            </div>

            {/* Endpoint */}
            <div>
                <label className="block text-xs text-gray-400 mb-1">Endpoint</label>
                <input
                    type="text"
                    value={profile.endpoint}
                    onChange={e => handleFieldChange('endpoint', e.target.value)}
                    placeholder="http://localhost:11434"
                    className="w-full p-2 text-sm bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-200"
                />
            </div>

            {/* Detect capabilities button */}
            <button
                onClick={handleDetect}
                disabled={isDetecting || !profile.endpoint}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-300"
                style={{
                    background: isDetecting
                        ? 'linear-gradient(90deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3))'
                        : 'linear-gradient(90deg, #06b6d4, #3b82f6)',
                    cursor: isDetecting || !profile.endpoint ? 'not-allowed' : 'pointer',
                    opacity: isDetecting || !profile.endpoint ? 0.6 : 1
                }}
            >
                {isDetecting ? '🔍 Détection...' : '🔍 Détecter capacités'}
            </button>

            {/* Progress bar */}
            {isDetecting && (
                <div className="relative w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="absolute h-full transition-all duration-300"
                        style={{
                            width: `${detectionProgress}%`,
                            background: 'linear-gradient(90deg, #06b6d4, #3b82f6, #9333ea)'
                        }}
                    />
                </div>
            )}

            {/* Detection error */}
            {detectionError && (
                <p className="text-xs text-red-400">{detectionError}</p>
            )}

            {/* Detection result report */}
            {detectionResult && !isDetecting && (
                <div className="p-3 rounded-lg" style={{
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)',
                    border: '1px solid rgba(6, 182, 212, 0.3)'
                }}>
                    <h4 className="text-green-400 font-semibold text-sm mb-2 flex items-center gap-2">
                        ✅ Modèle détecté: <span className="font-bold">{detectionResult.modelId}</span>
                    </h4>
                    {detectionResult.capabilities.length > 0 && (
                        <div className="mt-2 px-2 py-1.5 rounded-md" style={{
                            background: 'rgba(34, 197, 94, 0.15)',
                            border: '1px solid rgba(34, 197, 94, 0.5)'
                        }}>
                            <span className="text-green-400 text-xs font-semibold">⚡ Capacités détectées:</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                                {detectionResult.capabilities.map((cap: string) => (
                                    <span
                                        key={cap}
                                        className="px-2 py-0.5 rounded text-xs font-medium"
                                        style={{
                                            background: 'rgba(34, 197, 94, 0.2)',
                                            border: '1px solid rgba(34, 197, 94, 0.4)',
                                            color: '#86efac'
                                        }}
                                    >
                                        {cap}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Capabilities */}
            {Object.keys(profile.capabilities).length > 0 && (
                <div className="space-y-1 pt-1">
                    <label className="block text-xs text-gray-400 mb-1">Capacités</label>
                    {Object.keys(profile.capabilities).sort().map(cap => (
                        <div key={cap} className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">{cap}</span>
                            <ToggleSwitch
                                checked={(profile.capabilities as Record<string, boolean>)[cap] || false}
                                onChange={checked => handleCapabilityToggle(cap, checked)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
