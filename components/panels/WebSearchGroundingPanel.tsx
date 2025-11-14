import React from 'react';
import { SlideOver, Button } from '../UI';
import { WebSearchSource } from '../../types';

interface WebSearchGroundingPanelProps {
    isOpen: boolean;
    onClose: () => void;
    responseText: string;
    webSources: WebSearchSource[];
}

/**
 * WebSearchGroundingPanel - SlideOver lateral droit
 * 
 * Affiche les résultats Web Search Grounding avec :
 * - Texte de réponse
 * - Sources web (titre, URL, snippet)
 * - Citations cliquables
 */
export const WebSearchGroundingPanel: React.FC<WebSearchGroundingPanelProps> = ({
    isOpen,
    onClose,
    responseText,
    webSources
}) => {
    return (
        <SlideOver
            isOpen={isOpen}
            onClose={onClose}
            title="🌐 Web Search Results"
        >
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Response Text */}
                <div className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                    <h3 className="text-sm font-semibold text-cyan-400 mb-2">Response</h3>
                    <p className="text-gray-200 whitespace-pre-wrap">{responseText}</p>
                </div>

                {/* Web Sources */}
                {webSources.length > 0 && (
                    <div>
                        <h3 className="text-sm font-semibold text-gray-300 mb-3">
                            🔗 Sources ({webSources.length})
                        </h3>
                        <div className="space-y-3">
                            {webSources.map((source, index) => (
                                <div
                                    key={index}
                                    className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 
                             border border-gray-600 hover:border-purple-500 transition-colors"
                                >
                                    {/* Source Header */}
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex-1">
                                            <a
                                                href={source.uri}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-white font-semibold hover:text-cyan-300 transition-colors"
                                            >
                                                {source.webTitle}
                                            </a>
                                            <div className="text-xs text-gray-500 mt-1 break-all">
                                                {source.uri}
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-400 ml-2">
                                            #{index + 1}
                                        </div>
                                    </div>

                                    {/* Snippet */}
                                    {source.snippet && (
                                        <div className="mt-3 pt-3 border-t border-gray-700">
                                            <p className="text-sm text-gray-300 leading-relaxed">
                                                {source.snippet}
                                            </p>
                                        </div>
                                    )}

                                    {/* Open Link Button */}
                                    <div className="mt-3 flex justify-end">
                                        <a
                                            href={source.uri}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-purple-400 hover:text-purple-300 
                                 flex items-center gap-1 transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                            Visit Source
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* No sources */}
                {webSources.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                        <p>No web sources found</p>
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
