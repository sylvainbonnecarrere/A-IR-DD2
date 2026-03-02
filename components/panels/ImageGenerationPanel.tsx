import React, { useState, useRef } from 'react';
import { Agent, AgentInstance, LLMCapability, LLMConfig, WorkflowNode } from '../../types';
import { Button, SlideOver } from '../UI';
import * as llmService from '../../services/llmService';
import { useLocalization } from '../../hooks/useLocalization';
import { fileToBase64 } from '../../utils/fileUtils';

interface ImageGenerationPanelProps {
    isOpen: boolean;
    nodeId: string | null;
    agent?: Agent | null;
    agentInstance?: AgentInstance | null;
    workflowNodes: WorkflowNode[];
    llmConfigs: LLMConfig[];
    onClose: () => void;
    onImageGenerated: (nodeId: string, imageBase64: string) => void;
    onOpenImageModificationPanel: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
    hideSlideOver?: boolean;
}

export const ImageGenerationPanel = ({ 
    isOpen, 
    nodeId, 
    agent: agentProp,
    agentInstance: agentInstanceProp,
    workflowNodes, 
    llmConfigs, 
    onClose, 
    onImageGenerated, 
    onOpenImageModificationPanel, 
    hideSlideOver = false 
}: ImageGenerationPanelProps) => {
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { t } = useLocalization();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ⭐ UNIFIED DATA SOURCE: Source-agnostic (props FIRST priority, lookup fallback)
    const agent = agentProp || workflowNodes.find(n => n.id === nodeId)?.agent;
    const agentConfig = agent ? llmConfigs.find(c => c.provider === agent.llmProvider) : null;

    React.useEffect(() => {
        if (!isOpen) {
            setTimeout(() => {
                setPrompt('');
                setGeneratedImage(null);
                setError(null);
                setIsLoading(false);
            }, 300);
        }
    }, [isOpen]);

    // ⭐ EARLY RETURN: Check agent (not node) to avoid rendering null
    if (!agent || !nodeId) {
        return null;
    }
    
    if (!hideSlideOver && !isOpen) return null;

    const handleGenerate = async () => {
        if (!prompt.trim() || !agentConfig || !agent) {
            setError(t('imageGen_error_missingPrompt'));
            return;
        }

        setIsLoading(true);
        setError(null);
        setGeneratedImage(null);

        const result = await llmService.generateImage(agentConfig.provider, agentConfig.apiKey, prompt, agent.model);

        if (result.image) {
            setGeneratedImage(result.image);
        } else {
            setError(result.error || t('imageGen_error_unknown'));
        }

        setIsLoading(false);
    };

    const handleAddToChat = () => {
        if (generatedImage && nodeId) {
            onImageGenerated(nodeId, generatedImage);
            onClose();
        }
    };

    const handleEditImage = () => {
        if (generatedImage && nodeId) {
            onOpenImageModificationPanel(nodeId, generatedImage, agentProp, agentInstanceProp, 'image/png');
            onClose();
        }
    };

    const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && nodeId) {
            try {
                setIsLoading(true);
                setError(null);
                const imageBase64 = await fileToBase64(file);
                setGeneratedImage(imageBase64);
                setIsLoading(false);
            } catch (err) {
                console.error("Image import failed:", err);
                setError(t('imageGen_error_importFailed'));
                setIsLoading(false);
            }
        }
        if (e.target) {
            e.target.value = '';
        }
    };

    const formContent = (
        <div className="space-y-4">
            {agent.capabilities.includes(LLMCapability.ImageGeneration) && (
                <div>
                    <label htmlFor="image-prompt" className="block text-sm font-medium text-gray-300 mb-1">
                        {t('imageGen_promptLabel')}
                    </label>
                    <textarea
                        id="image-prompt"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={4}
                        className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder={t('imageGen_promptPlaceholder')}
                        disabled={isLoading}
                    />
                </div>
            )}

            <div className="flex items-center justify-center bg-gray-900/50 rounded-lg overflow-hidden min-h-[200px]">
                {isLoading && (
                    <div className="text-center p-4">
                        <p className="animate-pulse">{t('imageGen_generating')}</p>
                    </div>
                )}

                {error && <p className="text-sm text-red-400 p-4">{error}</p>}

                {generatedImage && (
                    <img
                        src={`data:image/png;base64,${generatedImage}`}
                        alt="Generated content"
                        className="rounded-lg object-contain max-w-full max-h-full"
                    />
                )}
                {!isLoading && !generatedImage && !error && (
                    <div className="text-gray-500">{t('imageGen_placeholder')}</div>
                )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                {generatedImage ? (
                    <>
                        {agent.capabilities.includes(LLMCapability.ImageModification) && (
                            <Button onClick={handleEditImage} variant="secondary">
                                {t('imageGen_editImage')}
                            </Button>
                        )}
                        <Button onClick={handleAddToChat} variant="primary">
                            {t('imageGen_addToChat')}
                        </Button>
                    </>
                ) : (
                    <>
                        {agent.capabilities.includes(LLMCapability.ImageModification) && (
                            <>
                                <Button onClick={() => fileInputRef.current?.click()} disabled={isLoading} variant="secondary">
                                    {t('imageGen_importImage')}
                                </Button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileImport}
                                    className="hidden"
                                    accept="image/png, image/jpeg, image/webp"
                                />
                            </>
                        )}
                        {agent.capabilities.includes(LLMCapability.ImageGeneration) && (
                            <Button onClick={handleGenerate} disabled={isLoading || !prompt.trim()} variant="primary">
                                {isLoading ? t('imageGen_generating_button') : t('imageGen_generate')}
                            </Button>
                        )}
                    </>
                )}
            </div>
        </div>
    );

    // Rendu pour HoloPanel (hideSlideOver=true)
    if (hideSlideOver) {
        return (
            <div className="w-full h-full flex flex-col bg-gray-900/50 text-white overflow-y-auto">
                <div className="sticky top-0 z-10 bg-gradient-to-r from-cyan-900/30 to-emerald-900/30 border-b border-cyan-500/20 px-6 py-4 flex items-center justify-between flex-shrink-0">
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-cyan-300">
                        🖼️ {t('imageGen_title', { agentName: agent.name })}
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
                    {formContent}
                </div>
            </div>
        );
    }

    // Rendu pour SlideOver modal
    return (
        <SlideOver title={t('imageGen_title', { agentName: agent.name })} isOpen={isOpen} onClose={onClose}>
            {formContent}
        </SlideOver>
    );
};
