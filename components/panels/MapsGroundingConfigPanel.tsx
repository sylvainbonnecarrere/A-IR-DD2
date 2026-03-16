import React, { useState, useEffect, useRef } from 'react';
import { SlideOver, Button } from '../UI';
import { LLMConfig, WorkflowNode, ChatMessage, MapSource } from '../../types';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import * as llmService from '../../services/llmService';

interface MapsGroundingConfigPanelProps {
    isOpen: boolean;
    nodeId: string | null;
    workflowNodes: WorkflowNode[];
    llmConfigs: LLMConfig[];
    onClose: () => void;
    preloadedResults?: {
        text: string;
        mapSources: MapSource[];
        query?: string;
    };
    hideSlideOver?: boolean;
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
    onClose,
    preloadedResults,
    hideSlideOver = false
}) => {
    const { addNodeMessage } = useRuntimeStore();
    const mapContainerRef = useRef<HTMLDivElement>(null);

    const node = workflowNodes.find(n => n.id === nodeId);
    const agent = node?.agent;
    // ✅ SAFE: find(provider) is correct for cloud-only panels (Maps Grounding = Gemini only).
    // Cloud providers have exactly ONE LLMConfig per provider type → no cross-agent contamination possible.
    // ⚠️ NEVER apply this pattern to local LLM calls (Ollama/LMStudio) — use localLLMProfileId instead.
    const agentConfig = llmConfigs.find(c => c.provider === agent?.llmProvider);

    const [query, setQuery] = useState('');
    const [useUserLocation, setUseUserLocation] = useState(false);
    const [customLat, setCustomLat] = useState('48.8566'); // Paris par défaut
    const [customLng, setCustomLng] = useState('2.3522');
    const [locationError, setLocationError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showExamples, setShowExamples] = useState(false);

    // État pour les résultats de recherche
    const [searchResults, setSearchResults] = useState<{
        text: string;
        mapSources: MapSource[];
    } | null>(null);
    const [mapInstance, setMapInstance] = useState<any>(null);

    // Charger les résultats pré-chargés à l'ouverture
    useEffect(() => {
        if (isOpen && preloadedResults) {
            setSearchResults(preloadedResults);
            if (preloadedResults.query) {
                setQuery(preloadedResults.query);
            }
        }
    }, [isOpen, preloadedResults]);

    // Initialiser la carte Leaflet
    useEffect(() => {
        if (!isOpen || !searchResults || !mapContainerRef.current || mapInstance) return;

        // Charger Leaflet dynamiquement
        const loadLeaflet = async () => {
            if (typeof window === 'undefined') return;

            // Injecter le CSS Leaflet si pas déjà présent
            if (!document.querySelector('link[href*="leaflet.css"]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                document.head.appendChild(link);
            }

            // Charger le script Leaflet
            if (!(window as any).L) {
                await new Promise((resolve) => {
                    const script = document.createElement('script');
                    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                    script.onload = resolve;
                    document.head.appendChild(script);
                });
            }

            const L = (window as any).L;
            if (!L || !mapContainerRef.current) return;

            // Calculer le centre de la carte
            const center = searchResults.mapSources.length > 0
                ? [searchResults.mapSources[0].coordinates.latitude, searchResults.mapSources[0].coordinates.longitude]
                : [48.8566, 2.3522]; // Paris par défaut

            // Créer la carte
            const map = L.map(mapContainerRef.current).setView(center, 13);

            // Ajouter le layer OpenStreetMap
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            // Ajouter les markers
            searchResults.mapSources.forEach((source, index) => {
                const marker = L.marker([source.coordinates.latitude, source.coordinates.longitude]).addTo(map);
                marker.bindPopup(`
                    <div style="min-width: 200px;">
                        <strong>${source.placeTitle}</strong><br/>
                        <a href="${source.uri}" target="_blank" rel="noopener noreferrer" style="color: #22d3ee;">🔗 Voir sur Maps</a>
                    </div>
                `);

                // Ouvrir le popup du premier marker
                if (index === 0) {
                    marker.openPopup();
                }
            });

            // Ajuster la vue pour afficher tous les markers
            if (searchResults.mapSources.length > 1) {
                const bounds = L.latLngBounds(
                    searchResults.mapSources.map(s => [s.coordinates.latitude, s.coordinates.longitude])
                );
                map.fitBounds(bounds, { padding: [50, 50] });
            }

            setMapInstance(map);
        };

        loadLeaflet();

        // Cleanup
        return () => {
            if (mapInstance) {
                mapInstance.remove();
                setMapInstance(null);
            }
        };
    }, [isOpen, searchResults, mapContainerRef.current]);

    // Nettoyer à la fermeture
    useEffect(() => {
        if (!isOpen) {
            if (mapInstance) {
                mapInstance.remove();
                setMapInstance(null);
            }
            setSearchResults(null);
            setQuery('');
        }
    }, [isOpen]);

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
                mapsGrounding: result.mapSources,
                timestamp: new Date()
            };
            addNodeMessage(nodeId, mapsMessage);

            // Afficher les résultats dans le panel
            setSearchResults({
                text: result.text,
                mapSources: result.mapSources
            });

            // Ne pas fermer le panel, afficher les résultats
            // onClose();
            // setQuery('');
            // setUseUserLocation(false);
            // setCustomLat('48.8566');
            // setCustomLng('2.3522');
            // setLocationError('');
        } catch (error) {
            console.error('Maps grounding failed:', error);

            // Add error message
            const errorMessage: ChatMessage = {
                id: `msg-${Date.now()}-maps-error`,
                sender: 'agent',
                text: `❌ Erreur Maps Grounding: ${error instanceof Error ? error.message : String(error)}`,
                timestamp: new Date()
            };
            addNodeMessage(nodeId, errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSearchResults(null);
        setQuery('');
        setUseUserLocation(false);
        setCustomLat('48.8566');
        setCustomLng('2.3522');
        setLocationError('');
        if (mapInstance) {
            mapInstance.remove();
            setMapInstance(null);
        }
    };

    // Si hideSlideOver, afficher sans le SlideOver wrapper
    if (hideSlideOver) {
        return (
            <div className="w-full h-full flex flex-col bg-gray-900/50 text-white overflow-y-auto">
                <div className="sticky top-0 z-10 bg-gradient-to-r from-cyan-900/30 to-emerald-900/30 border-b border-cyan-500/20 px-6 py-4 flex items-center justify-between flex-shrink-0">
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-cyan-300">
                        🗺️ Maps Grounding
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-cyan-400 text-2xl leading-none transition-colors"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                    {renderSlideOverContent()}
                </div>
            </div>
        );
    }

    return (
        <SlideOver
            isOpen={isOpen}
            onClose={onClose}
            title="🗺️ Maps Grounding - Configuration"
        >
            {renderSlideOverContent()}
        </SlideOver>
    );

    function renderSlideOverContent() {
        return (
            <>
                {/* Résultats de recherche avec carte */}
                {searchResults && searchResults.mapSources.length > 0 ? (
                <div className="space-y-4 h-full flex flex-col">
                    {/* Carte interactive */}
                    <div className="flex-shrink-0">
                        <div
                            ref={mapContainerRef}
                            className="w-full h-[300px] rounded-lg border border-gray-600 bg-gray-800"
                            style={{ zIndex: 1 }}
                        />
                    </div>

                    {/* Liste des résultats avec scrolling */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                        <div className="text-sm font-semibold text-cyan-400 mb-2">
                            📍 Lieux trouvés ({searchResults.mapSources.length})
                        </div>
                        {searchResults.mapSources.map((source, index) => (
                            <div
                                key={index}
                                className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 
                                         border border-gray-600 hover:border-cyan-500 transition-all
                                         cursor-pointer"
                                onClick={() => {
                                    if (mapInstance && (window as any).L) {
                                        const L = (window as any).L;
                                        mapInstance.setView(
                                            [source.coordinates.latitude, source.coordinates.longitude],
                                            15
                                        );
                                        // Ouvrir le popup du marker correspondant
                                        mapInstance.eachLayer((layer: any) => {
                                            if (layer instanceof L.Marker) {
                                                const latLng = layer.getLatLng();
                                                if (
                                                    Math.abs(latLng.lat - source.coordinates.latitude) < 0.0001 &&
                                                    Math.abs(latLng.lng - source.coordinates.longitude) < 0.0001
                                                ) {
                                                    layer.openPopup();
                                                }
                                            }
                                        });
                                    }
                                }}
                            >
                                {/* Place Title */}
                                <div className="flex items-start justify-between mb-2">
                                    <h4 className="text-white font-semibold flex-1">
                                        {source.placeTitle}
                                    </h4>
                                    <span className="text-cyan-400 text-xs ml-2">#{index + 1}</span>
                                </div>

                                {/* Coordinates */}
                                {source.coordinates && (
                                    <div className="text-xs text-gray-400 mb-2 font-mono">
                                        📍 {source.coordinates.latitude.toFixed(6)}, {source.coordinates.longitude.toFixed(6)}
                                    </div>
                                )}

                                {/* Links */}
                                <div className="flex gap-2 mt-2">
                                    <a
                                        href={source.uri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 text-xs inline-flex items-center gap-1"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        🔗 Google Maps
                                    </a>
                                </div>

                                {/* Review Excerpts */}
                                {source.reviewExcerpts && source.reviewExcerpts.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-700">
                                        <p className="text-xs text-gray-400 mb-2">⭐ Avis:</p>
                                        <div className="space-y-1">
                                            {source.reviewExcerpts.slice(0, 2).map((review, reviewIndex) => (
                                                <div
                                                    key={reviewIndex}
                                                    className="text-xs text-gray-300 italic"
                                                >
                                                    "{review}"
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Réponse de l'agent */}
                    {searchResults.text && (
                        <div className="flex-shrink-0 bg-gray-800/50 rounded-lg p-3 border border-gray-600">
                            <div className="text-xs font-semibold text-cyan-400 mb-1">💬 Réponse de l'agent</div>
                            <div className="text-sm text-gray-200 whitespace-pre-wrap">{searchResults.text}</div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t border-gray-700 flex-shrink-0">
                        <Button
                            variant="secondary"
                            onClick={handleReset}
                            className="flex-1"
                        >
                            🔄 Nouvelle recherche
                        </Button>
                        <Button
                            variant="primary"
                            onClick={onClose}
                            className="flex-1"
                        >
                            Fermer
                        </Button>
                    </div>
                </div>
            ) : (
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
            )}
            </>
        );
    }
};
