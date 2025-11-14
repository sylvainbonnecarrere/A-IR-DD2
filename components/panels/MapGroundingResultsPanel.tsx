import React from 'react';
import { SlideOver, Button } from '../UI';
import { MapSource } from '../../types';

interface MapGroundingResultsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    responseText: string;
    mapSources: MapSource[];
}

/**
 * MapGroundingResultsPanel - SlideOver lateral droit
 * 
 * Affiche les résultats Maps Grounding avec :
 * - Texte de réponse
 * - Lieux trouvés (nom, coordonnées GPS)
 * - Extraits d'avis
 * - Liens Google Maps
 */
export const MapGroundingResultsPanel: React.FC<MapGroundingResultsPanelProps> = ({
    isOpen,
    onClose,
    responseText,
    mapSources
}) => {
    return (
        <SlideOver
            isOpen={isOpen}
            onClose={onClose}
            title="🗺️ Maps Search Results"
        >
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Response Text */}
                <div className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                    <h3 className="text-sm font-semibold text-cyan-400 mb-2">Response</h3>
                    <p className="text-gray-200 whitespace-pre-wrap">{responseText}</p>
                </div>

                {/* Map Sources */}
                {mapSources.length > 0 && (
                    <div>
                        <h3 className="text-sm font-semibold text-gray-300 mb-3">
                            📍 Places Found ({mapSources.length})
                        </h3>
                        <div className="space-y-3">
                            {mapSources.map((source, index) => (
                                <div
                                    key={index}
                                    className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 
                             border border-gray-600 hover:border-cyan-500 transition-colors"
                                >
                                    {/* Place Title */}
                                    <div className="flex items-start justify-between mb-2">
                                        <h4 className="text-white font-semibold flex-1">
                                            {source.placeTitle}
                                        </h4>
                                        <a
                                            href={source.uri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-cyan-400 hover:text-cyan-300 text-sm ml-2"
                                        >
                                            🔗 Open Map
                                        </a>
                                    </div>

                                    {/* Coordinates */}
                                    {source.coordinates && (
                                        <div className="text-xs text-gray-400 mb-2 font-mono">
                                            📍 {source.coordinates.latitude.toFixed(6)}, {source.coordinates.longitude.toFixed(6)}
                                        </div>
                                    )}

                                    {/* Place ID */}
                                    {source.placeId && (
                                        <div className="text-xs text-gray-500 mb-2">
                                            ID: {source.placeId}
                                        </div>
                                    )}

                                    {/* Review Excerpts */}
                                    {source.reviewExcerpts && source.reviewExcerpts.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-gray-700">
                                            <p className="text-xs text-gray-400 mb-2">⭐ Reviews:</p>
                                            <div className="space-y-2">
                                                {source.reviewExcerpts.map((review, reviewIndex) => (
                                                    <div
                                                        key={reviewIndex}
                                                        className="bg-gray-900/50 rounded p-2 text-sm text-gray-300 italic"
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
                    </div>
                )}

                {/* No sources */}
                {mapSources.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                        <p>No map sources found</p>
                    </div>
                )}

                {/* Close Button */}
                <div className="flex justify-end pt-4 border-t border-gray-700">
                    <Button variant="secondary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </SlideOver>
    );
};
