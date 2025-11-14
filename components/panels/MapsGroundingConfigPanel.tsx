import React, { useState, useEffect } from 'react';
import { SlideOver, Button } from '../UI';
import { LLMConfig, WorkflowNode, ChatMessage } from '../../types';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import * as llmService from '../../services/llmService';

interface MapsGroundingConfigPanelProps {
    isOpen: boolean;
    nodeId: string | null;
    workflowNodes: WorkflowNode[];
    llmConfigs: LLMConfig[];
    onClose: () => void;
}

/**
 * MapsGroundingConfigPanel - Configuration Maps Grounding
 * 
 * Permet de configurer la recherche Maps avec :
 * - Requête de recherche
 * - Géolocalisation automatique ou manuelle
 * - Coordonnées GPS personnalisées
 */
export const MapsGroundingConfigPanel: React.FC<MapsGroundingConfigPanelProps> = ({
    isOpen,
    nodeId,
    workflowNodes,
    llmConfigs,
    onClose
}) => {
    const { addNodeMessage } = useRuntimeStore();

    const node = workflowNodes.find(n => n.id === nodeId);
    const agent = node?.agent;
    const agentConfig = llmConfigs.find(c => c.provider === agent?.llmProvider);

    const [query, setQuery] = useState('');
    const [useUserLocation, setUseUserLocation] = useState(false);
    const [customLat, setCustomLat] = useState('48.8566'); // Paris par défaut
    const [customLng, setCustomLng] = useState('2.3522');
    const [locationError, setLocationError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showExamples, setShowExamples] = useState(false);

    const handleGetLocation = () => {
        setLocationError('');
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setCustomLat(position.coords.latitude.toFixed(6));
                    setCustomLng(position.coords.longitude.toFixed(6));
                    setUseUserLocation(true);
                    setLocationError('');
                },
                (error) => {
                    setLocationError(`Erreur géolocalisation: ${error.message}`);
                    setUseUserLocation(false);
                }
            );
        } else {
            setLocationError('Géolocalisation non supportée par ce navigateur');
        }
    };

    const handleSubmit = async () => {
        if (!query.trim() || !nodeId || !agent || !agentConfig?.enabled || !agentConfig?.apiKey) {
            return;
        }

        setIsLoading(true);

        try {
            // Build user location if requested
            const userLocation = useUserLocation
                ? {
                    lat: parseFloat(customLat),
                    lng: parseFloat(customLng)
                }
                : undefined;

            // Call Maps API
            const result = await llmService.generateContentWithMaps(
                agent.llmProvider,
                agentConfig.apiKey,
                agent.model,
                query,
                agent.systemInstruction,
                userLocation
            );

            // Add Maps message to node
            const mapsMessage: ChatMessage = {
                id: `msg-${Date.now()}-maps`,
                sender: 'agent',
                text: result.text,
                mapsGrounding: result.mapSources
            };
            addNodeMessage(nodeId, mapsMessage);

            // Close panel and reset
            onClose();
            setQuery('');
            setUseUserLocation(false);
            setCustomLat('48.8566');
            setCustomLng('2.3522');
            setLocationError('');
        } catch (error) {
            console.error('Maps grounding failed:', error);

            // Add error message
            const errorMessage: ChatMessage = {
                id: `msg-${Date.now()}-maps-error`,
                sender: 'agent',
                text: `❌ Erreur Maps Grounding: ${error instanceof Error ? error.message : String(error)}`
            };
            addNodeMessage(nodeId, errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <SlideOver
            isOpen={isOpen}
            onClose={onClose}
            title="🗺️ Maps Grounding - Configuration"
        >
            <div className="space-y-6">
                {/* Query Input */}
                <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">
                        Recherche Maps
                    </label>
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Ex: Restaurants japonais à Paris, Hôtels 5 étoiles à New York..."
                        className="w-full h-24 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg 
                                 text-gray-200 placeholder-gray-500 
                                 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent
                                 resize-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        💡 Soyez précis pour des résultats pertinents
                    </p>
                </div>

                {/* Location Options */}
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-600">
                    <div className="flex items-center justify-between mb-3">
                        <label className="flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={useUserLocation}
                                onChange={(e) => setUseUserLocation(e.target.checked)}
                                className="mr-2 w-4 h-4 text-cyan-500 bg-gray-700 border-gray-600 
                                         rounded focus:ring-cyan-500"
                            />
                            <span className="text-sm font-semibold text-gray-300">
                                📍 Utiliser la géolocalisation
                            </span>
                        </label>

                        <button
                            onClick={handleGetLocation}
                            className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 
                                     text-white rounded transition-colors"
                        >
                            Détecter ma position
                        </button>
                    </div>

                    {useUserLocation && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Latitude
                                    </label>
                                    <input
                                        type="text"
                                        value={customLat}
                                        onChange={(e) => setCustomLat(e.target.value)}
                                        placeholder="48.8566"
                                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 
                                                 rounded text-gray-200 text-sm
                                                 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Longitude
                                    </label>
                                    <input
                                        type="text"
                                        value={customLng}
                                        onChange={(e) => setCustomLng(e.target.value)}
                                        placeholder="2.3522"
                                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 
                                                 rounded text-gray-200 text-sm
                                                 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                    />
                                </div>
                            </div>

                            {locationError && (
                                <div className="text-xs text-red-400 bg-red-900/20 rounded p-2">
                                    ⚠️ {locationError}
                                </div>
                            )}

                            <p className="text-xs text-gray-500">
                                💡 Les résultats seront centrés autour de ces coordonnées
                            </p>
                        </div>
                    )}

                    {!useUserLocation && (
                        <p className="text-xs text-gray-500">
                            Sans géolocalisation, la recherche utilisera les coordonnées par défaut ou celles du contexte de la requête
                        </p>
                    )}
                </div>

                {/* Examples - Collapsible */}
                <div className="bg-gray-900/50 rounded-lg border border-gray-700">
                    <button
                        type="button"
                        onClick={() => setShowExamples(!showExamples)}
                        className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-gray-400 hover:text-gray-300 transition-colors"
                    >
                        <span>Exemples de requêtes</span>
                        <svg
                            className={`w-4 h-4 transition-transform duration-200 ${showExamples ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    {showExamples && (
                        <ul className="px-3 pb-3 text-xs text-gray-500 space-y-1 border-t border-gray-700 pt-2">
                            <li>• "Restaurants italiens avec terrasse à Lyon"</li>
                            <li>• "Pharmacies ouvertes 24h/24 à proximité"</li>
                            <li>• "Hôtels avec spa et piscine à Marseille"</li>
                            <li>• "Stations essence sur l'A6 direction Lyon"</li>
                        </ul>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-gray-700">
                    <Button
                        variant="secondary"
                        onClick={onClose}
                        className="flex-1"
                    >
                        Annuler
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={!query.trim() || isLoading}
                        className="flex-1"
                    >
                        {isLoading ? '🔄 Recherche...' : '🔍 Rechercher'}
                    </Button>
                </div>
            </div>
        </SlideOver>
    );
};
