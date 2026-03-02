import React, { useState, useEffect } from 'react';
import { LLMConfig, WorkflowNode, ChatMessage, Agent, AgentInstance } from '../../types';
import { Button, SlideOver } from '../UI';
import * as llmService from '../../services/llmService';
import { useLocalization } from '../../hooks/useLocalization';

interface EditingImageInfo {
  nodeId: string;
  sourceImage: string;
  mimeType: string;
  agent?: Agent;
  agentInstance?: AgentInstance;
}

interface ImageModificationPanelProps {
    isOpen: boolean;
    editingImageInfo: EditingImageInfo | null;
    workflowNodes: WorkflowNode[];
    llmConfigs: LLMConfig[];
    onClose: () => void;
    onImageModified: (nodeId: string, newImage: string, text: string) => void;
}

export const ImageModificationPanel = ({ isOpen, editingImageInfo, workflowNodes, llmConfigs, onClose, onImageModified }: ImageModificationPanelProps) => {
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [modifiedImage, setModifiedImage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [currentSourceImage, setCurrentSourceImage] = useState<string | null>(null);
    const { t } = useLocalization();

    // Use agent from editingImageInfo if available (fresh from V2AgentNode)
    // Otherwise fallback to lookup from workflowNodes
    const agent = editingImageInfo?.agent || workflowNodes.find(n => n.id === editingImageInfo?.nodeId)?.agent;
    const agentConfig = llmConfigs.find(c => c.provider === agent?.llmProvider);
    
    useEffect(() => {
        if (isOpen && editingImageInfo) {
            setCurrentSourceImage(editingImageInfo.sourceImage);
            setModifiedImage(null);
            setError(null);
            setPrompt('');
        } else if (!isOpen) {
            setTimeout(() => {
                setPrompt('');
                setModifiedImage(null);
                setError(null);
                setCurrentSourceImage(null);
            }, 300);
        }
    }, [isOpen, editingImageInfo]);


    const handleModify = async () => {
        if (!prompt.trim() || !agentConfig || !agent || !currentSourceImage || !editingImageInfo) {
            setError(t('imageMod_error_missingPrompt'));
            return;
        }

        setIsLoading(true);
        setError(null);
        setModifiedImage(null);

        const result = await llmService.editImage(
            agentConfig.provider, 
            agentConfig.apiKey, 
            prompt, 
            { mimeType: editingImageInfo.mimeType, data: currentSourceImage }
        );

        if (result.image) {
            setModifiedImage(result.image);
        } else {
            setError(result.error || t('imageMod_error_unknown'));
        }

        setIsLoading(false);
    };
    
    const handleModifyFurther = () => {
        if (modifiedImage) {
            setCurrentSourceImage(modifiedImage);
            setModifiedImage(null);
            setPrompt('');
            setError(null);
        }
    };
    
    const handleAddToChat = async () => {
        if (modifiedImage && editingImageInfo) {
             if (!agentConfig) {
                onImageModified(editingImageInfo.nodeId, modifiedImage, `Image modifiée.`);
                onClose();
                return;
            }

            const descriptionPrompt = `Vous venez de modifier une image. Décrivez brièvement la modification que vous avez effectuée, en vous basant sur le prompt original de l'utilisateur: "${prompt}".`;
            const descriptionHistory: ChatMessage[] = [{
                id: `msg-desc-prompt-${Date.now()}`,
                sender: 'user',
                text: descriptionPrompt,
                timestamp: new Date()
            }];

            const { text } = await llmService.generateContent(
                agentConfig.provider,
                agentConfig.apiKey,
                'gemini-2.5-flash',
                "Vous êtes un assistant IA qui décrit les modifications d'images.",
                descriptionHistory
            );
            
            onImageModified(editingImageInfo.nodeId, modifiedImage, text || `Image modifiée selon vos instructions.`);
            onClose();
        }
    };

    if (!agent || !editingImageInfo || !currentSourceImage) return null;

    return (
        <SlideOver title={t('imageMod_title', { agentName: agent.name })} isOpen={isOpen} onClose={onClose}>
            <div className="space-y-4 h-full flex flex-col">
                <div className="p-2 bg-gray-900/50 rounded-lg">
                    <label className="block text-sm font-medium text-gray-400 mb-2 text-center">{t('imageMod_originalImage')}</label>
                    <img 
                        src={`data:${editingImageInfo.mimeType};base64,${currentSourceImage}`} 
                        alt="Source for modification" 
                        className="rounded-lg object-contain max-w-full max-h-48 mx-auto"
                    />
                </div>

                <div>
                    <label htmlFor="image-prompt-modify" className="block text-sm font-medium text-gray-300 mb-1">
                        {t('imageMod_promptLabel')}
                    </label>
                    <textarea
                        id="image-prompt-modify"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                        className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder={t('imageMod_promptPlaceholder')}
                        disabled={isLoading}
                    />
                </div>

                <div className="flex-1 flex items-center justify-center bg-gray-900/50 rounded-lg overflow-hidden">
                    {isLoading && (
                        <div className="text-center p-4">
                            <p className="animate-pulse">{t('imageMod_modifying')}</p>
                        </div>
                    )}
                    
                    {error && <p className="text-sm text-red-400 p-4">{error}</p>}
                    
                    {modifiedImage && (
                        <img 
                            src={`data:${editingImageInfo.mimeType};base64,${modifiedImage}`} 
                            alt="Modified content" 
                            className="rounded-lg object-contain max-w-full max-h-full"
                        />
                    )}
                     {!isLoading && !modifiedImage && !error && (
                         <div className="text-gray-500">{t('imageMod_placeholder')}</div>
                     )}
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                    {modifiedImage ? (
                        <>
                            <Button onClick={handleModifyFurther} variant="secondary">
                                {t('imageMod_modifyAgain')}
                            </Button>
                            <Button onClick={handleAddToChat} variant="primary">
                                {t('imageMod_addToChat')}
                            </Button>
                        </>
                    ) : (
                        <Button onClick={handleModify} disabled={isLoading || !prompt.trim()} variant="primary">
                            {isLoading ? t('imageMod_modifying_button') : t('imageMod_modify')}
                        </Button>
                    )}
                </div>
            </div>
        </SlideOver>
    );
};