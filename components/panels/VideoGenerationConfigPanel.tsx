import React, { useState, useRef, useEffect } from 'react';
import { VideoGenerationOptions, LLMConfig, WorkflowNode, ChatMessage, VideoGenerationStatus } from '../../types';
import { useLocalization } from '../../hooks/useLocalization';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import * as llmService from '../../services/llmService';

interface VideoGenerationConfigPanelProps {
    isOpen: boolean;
    nodeId: string | null;
    workflowNodes: WorkflowNode[];
    llmConfigs: LLMConfig[];
    onClose: () => void;
}

type VideoMode = 'text-to-video' | 'image-to-video' | 'interpolation' | 'extension' | 'with-references';

export const VideoGenerationConfigPanel: React.FC<VideoGenerationConfigPanelProps> = ({
    isOpen,
    nodeId,
    workflowNodes,
    llmConfigs,
    onClose
}) => {
    const { t } = useLocalization();
    const { getNodeMessages, addNodeMessage, setNodeMessages } = useRuntimeStore();

    const node = workflowNodes.find(n => n.id === nodeId);
    const agent = node?.agent;
    const agentConfig = llmConfigs.find(c => c.provider === agent?.llmProvider);

    const [mode, setMode] = useState<VideoMode>('text-to-video');
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
    const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
    const [durationSeconds, setDurationSeconds] = useState<4 | 6 | 8>(8);
    const [personGeneration, setPersonGeneration] = useState<'allow_all' | 'allow_adult' | 'dont_allow'>('allow_all');
    const [seed, setSeed] = useState<number | undefined>(undefined);

    // Image uploads
    const [firstFrame, setFirstFrame] = useState<{ mimeType: string; data: string } | undefined>(undefined);
    const [lastFrame, setLastFrame] = useState<{ mimeType: string; data: string } | undefined>(undefined);
    const [referenceImages, setReferenceImages] = useState<Array<{ image: { mimeType: string; data: string }; referenceType: 'asset' }>>([]);

    const firstFrameInputRef = useRef<HTMLInputElement>(null);
    const lastFrameInputRef = useRef<HTMLInputElement>(null);
    const referenceInputRef = useRef<HTMLInputElement>(null);

    // Reset state when panel is closed
    useEffect(() => {
        if (!isOpen) {
            setTimeout(() => {
                setMode('text-to-video');
                setPrompt('');
                setNegativePrompt('');
                setResolution('720p');
                setAspectRatio('16:9');
                setDurationSeconds(8);
                setPersonGeneration('allow_all');
                setSeed(undefined);
                setFirstFrame(undefined);
                setLastFrame(undefined);
                setReferenceImages([]);
            }, 300); // Wait for slide-out animation
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleImageUpload = (
        file: File,
        setter: React.Dispatch<React.SetStateAction<{ mimeType: string; data: string } | undefined>>
    ) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            const data = base64.split(',')[1]; // Remove data:image/xxx;base64, prefix
            setter({ mimeType: file.type, data });
        };
        reader.readAsDataURL(file);
    };

    const handleReferenceImageUpload = (files: FileList | null) => {
        if (!files) return;
        const fileArray = Array.from(files).slice(0, 3 - referenceImages.length); // Max 3 total

        fileArray.forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                const data = base64.split(',')[1];
                setReferenceImages(prev => [
                    ...prev,
                    { image: { mimeType: file.type, data }, referenceType: 'asset' }
                ]);
            };
            reader.readAsDataURL(file);
        });
    };

    const handleSubmit = async () => {
        if (!nodeId || !agent || !agentConfig) {
            alert(t('videoGen_error_noAgent'));
            return;
        }

        if (!prompt.trim()) {
            alert(t('videoGen_error_noPrompt'));
            return;
        }

        // Mode-specific validation
        if (mode === 'image-to-video' && !firstFrame) {
            alert(t('videoGen_error_noFirstFrame'));
            return;
        }
        if (mode === 'interpolation' && (!firstFrame || !lastFrame)) {
            alert(t('videoGen_error_noFrames'));
            return;
        }
        if (mode === 'with-references' && referenceImages.length === 0) {
            alert(t('videoGen_error_noReferences'));
            return;
        }

        // Resolution compatibility check
        if (resolution === '1080p' && (aspectRatio !== '16:9' || durationSeconds !== 8)) {
            alert(t('videoGen_error_resolution'));
            return;
        }

        const config: VideoGenerationOptions = {
            prompt,
            negativePrompt: negativePrompt.trim() || undefined,
            mode,
            resolution,
            aspectRatio,
            durationSeconds,
            personGeneration,
            seed,
        };

        // Add mode-specific fields
        if (mode === 'image-to-video' || mode === 'interpolation') {
            config.firstFrame = firstFrame;
        }
        if (mode === 'interpolation') {
            config.lastFrame = lastFrame;
        }
        if (mode === 'with-references') {
            config.referenceImages = referenceImages;
        }

        // Close panel immediately
        onClose();

        // Create initial video message
        const videoMessageId = `msg-${Date.now()}`;
        const initialVideoMessage: ChatMessage = {
            id: videoMessageId,
            sender: 'agent',
            text: `🎬 ${t('videoGen_status_processing')}`,
            videoGeneration: {
                operationId: '',
                prompt: config.prompt,
                status: 'processing'
            }
        };

        addNodeMessage(nodeId, initialVideoMessage);

        try {
            const result = await llmService.generateVideo(
                agent.llmProvider,
                agentConfig.apiKey,
                config
            );

            if (result.status === 'FAILED') {
                const messages = getNodeMessages(nodeId);
                const updatedMessages = messages.map(msg =>
                    msg.id === videoMessageId
                        ? {
                            ...msg,
                            text: `❌ ${t('videoGen_status_failed')}${result.error ? ': ' + result.error : ''}`,
                            videoGeneration: {
                                ...msg.videoGeneration!,
                                status: 'failed' as const,
                                error: result.error
                            }
                        }
                        : msg
                );
                setNodeMessages(nodeId, updatedMessages);
                return;
            }

            // Update message with operationId
            const messages = getNodeMessages(nodeId);
            const updatedMessagesWithOp = messages.map(msg =>
                msg.id === videoMessageId
                    ? {
                        ...msg,
                        videoGeneration: {
                            ...msg.videoGeneration!,
                            operationId: result.operationId
                        }
                    }
                    : msg
            );
            setNodeMessages(nodeId, updatedMessagesWithOp);

            // Start polling
            handleVideoPoll(agentConfig.apiKey, result.operationId, videoMessageId);
        } catch (error) {
            console.error('Video generation failed:', error);
            const messages = getNodeMessages(nodeId);
            const updatedMessages = messages.map(msg =>
                msg.id === videoMessageId
                    ? {
                        ...msg,
                        text: `❌ ${t('videoGen_status_failed')}${error instanceof Error ? ': ' + error.message : ''}`,
                        videoGeneration: {
                            ...msg.videoGeneration!,
                            status: 'failed' as const,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        }
                    }
                    : msg
            );
            setNodeMessages(nodeId, updatedMessages);
        }
    };

    const handleVideoPoll = async (apiKey: string, operationId: string, messageId: string) => {
        if (!agent || !nodeId) return;

        const pollInterval = setInterval(async () => {
            try {
                const status = await llmService.pollVideoOperation(
                    agent.llmProvider,
                    apiKey,
                    operationId
                );

                const messages = getNodeMessages(nodeId);
                const updatedMessages = messages.map(msg =>
                    msg.id === messageId
                        ? {
                            ...msg,
                            text: status.status === 'COMPLETED'
                                ? `✅ ${t('videoGen_status_completed')}`
                                : status.status === 'FAILED'
                                    ? `❌ ${t('videoGen_status_failed')}${status.error ? ': ' + status.error : ''}`
                                    : `🎬 ${t('videoGen_status_processing')}`,
                            videoGeneration: {
                                ...msg.videoGeneration!,
                                status: (status.status === 'COMPLETED' ? 'completed' : status.status === 'FAILED' ? 'failed' : 'processing') as 'processing' | 'completed' | 'failed',
                                videoUrl: status.videoUrl,
                                error: status.error
                            }
                        }
                        : msg
                );
                setNodeMessages(nodeId, updatedMessages);

                if (status.status === 'COMPLETED' || status.status === 'FAILED') {
                    clearInterval(pollInterval);
                }
            } catch (error) {
                console.error('Error polling video operation:', error);
                clearInterval(pollInterval);
            }
        }, 10000); // Poll every 10 seconds
    };

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div className="h-full w-full max-w-md bg-gray-900 text-white shadow-2xl overflow-y-auto animate-slide-in-right">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        🎬 {t('videoGen_title')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Mode Selection */}
                    <div>
                        <label className="block text-sm font-medium mb-2">{t('videoGen_mode')}</label>
                        <select
                            value={mode}
                            onChange={(e) => setMode(e.target.value as VideoMode)}
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                        >
                            <option value="text-to-video">{t('videoGen_mode_textToVideo')}</option>
                            <option value="image-to-video">{t('videoGen_mode_imageToVideo')}</option>
                            <option value="interpolation">{t('videoGen_mode_interpolation')}</option>
                            <option value="extension">{t('videoGen_mode_extension')}</option>
                            <option value="with-references">{t('videoGen_mode_withReferences')}</option>
                        </select>
                        <p className="text-xs text-gray-400 mt-1">
                            {mode === 'text-to-video' && t('videoGen_mode_desc_textToVideo')}
                            {mode === 'image-to-video' && t('videoGen_mode_desc_imageToVideo')}
                            {mode === 'interpolation' && t('videoGen_mode_desc_interpolation')}
                            {mode === 'extension' && t('videoGen_mode_desc_extension')}
                            {mode === 'with-references' && t('videoGen_mode_desc_withReferences')}
                        </p>
                    </div>

                    {/* Prompt */}
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            {t('videoGen_prompt')} <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={4}
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white resize-none"
                            placeholder={t('videoGen_prompt_placeholder')}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            {t('videoGen_prompt_helper')}
                        </p>
                    </div>

                    {/* Negative Prompt */}
                    <div>
                        <label className="block text-sm font-medium mb-2">{t('videoGen_negativePrompt')}</label>
                        <input
                            type="text"
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                            placeholder={t('videoGen_negativePrompt_placeholder')}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            {t('videoGen_negativePrompt_helper')}
                        </p>
                    </div>

                    {/* Conditional: Image-to-Video / Interpolation First Frame */}
                    {(mode === 'image-to-video' || mode === 'interpolation') && (
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                {mode === 'image-to-video' ? t('videoGen_sourceFrame') : t('videoGen_firstFrame_required')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                ref={firstFrameInputRef}
                                type="file"
                                accept="image/*"
                                onChange={(e) => e.target.files && handleImageUpload(e.target.files[0], setFirstFrame)}
                                className="hidden"
                            />
                            <button
                                onClick={() => firstFrameInputRef.current?.click()}
                                className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white"
                            >
                                {firstFrame ? `✅ ${t('videoGen_firstFrame')}` : `📤 ${t('videoGen_firstFrame')}`}
                            </button>
                            {firstFrame && (
                                <div className="mt-2">
                                    <img
                                        src={`data:${firstFrame.mimeType};base64,${firstFrame.data}`}
                                        alt="First Frame"
                                        className="w-full rounded border border-gray-600"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Conditional: Interpolation Last Frame */}
                    {mode === 'interpolation' && (
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                {t('videoGen_lastFrame')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                ref={lastFrameInputRef}
                                type="file"
                                accept="image/*"
                                onChange={(e) => e.target.files && handleImageUpload(e.target.files[0], setLastFrame)}
                                className="hidden"
                            />
                            <button
                                onClick={() => lastFrameInputRef.current?.click()}
                                className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white"
                            >
                                {lastFrame ? `✅ ${t('videoGen_lastFrame')}` : `📤 ${t('videoGen_lastFrame')}`}
                            </button>
                            {lastFrame && (
                                <div className="mt-2">
                                    <img
                                        src={`data:${lastFrame.mimeType};base64,${lastFrame.data}`}
                                        alt="Last Frame"
                                        className="w-full rounded border border-gray-600"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Conditional: Reference Images */}
                    {mode === 'with-references' && (
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                {t('videoGen_referenceImages')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                ref={referenceInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => handleReferenceImageUpload(e.target.files)}
                                className="hidden"
                            />
                            <button
                                onClick={() => referenceInputRef.current?.click()}
                                className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white"
                                disabled={referenceImages.length >= 3}
                            >
                                {referenceImages.length >= 3
                                    ? `✅ ${t('videoGen_referenceImages')}`
                                    : `📤 ${t('videoGen_referenceImages')} (${referenceImages.length}/3)`}
                            </button>
                            {referenceImages.length > 0 && (
                                <div className="mt-2 grid grid-cols-3 gap-2">
                                    {referenceImages.map((ref, idx) => (
                                        <div key={idx} className="relative">
                                            <img
                                                src={`data:${ref.image.mimeType};base64,${ref.image.data}`}
                                                alt={`Reference ${idx + 1}`}
                                                className="w-full h-20 object-cover rounded border border-gray-600"
                                            />
                                            <button
                                                onClick={() => setReferenceImages(prev => prev.filter((_, i) => i !== idx))}
                                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs text-gray-400 mt-1">
                                Upload images for style/content guidance (e.g., specific clothing, colors, objects)
                            </p>
                        </div>
                    )}

                    {/* Parameters */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-2">{t('videoGen_resolution')}</label>
                            <select
                                value={resolution}
                                onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                            >
                                <option value="720p">720p</option>
                                <option value="1080p">1080p (16:9, 8s)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">{t('videoGen_aspectRatio')}</label>
                            <select
                                value={aspectRatio}
                                onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16')}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                            >
                                <option value="16:9">16:9</option>
                                <option value="9:16">9:16</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">{t('videoGen_duration')}</label>
                            <select
                                value={durationSeconds}
                                onChange={(e) => setDurationSeconds(Number(e.target.value) as 4 | 6 | 8)}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                            >
                                <option value={4}>4s</option>
                                <option value={6}>6s</option>
                                <option value={8}>8s</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">{t('videoGen_personGeneration')}</label>
                            <select
                                value={personGeneration}
                                onChange={(e) => setPersonGeneration(e.target.value as 'allow_all' | 'allow_adult' | 'dont_allow')}
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                            >
                                <option value="allow_all">{t('videoGen_personGeneration_allowAll')}</option>
                                <option value="allow_adult">{t('videoGen_personGeneration_allowAdult')}</option>
                                <option value="dont_allow">{t('videoGen_personGeneration_dontAllow')}</option>
                            </select>
                        </div>
                    </div>

                    {/* Seed (Optional) */}
                    <div>
                        <label className="block text-sm font-medium mb-2">{t('videoGen_seed')}</label>
                        <input
                            type="number"
                            value={seed ?? ''}
                            onChange={(e) => setSeed(e.target.value ? Number(e.target.value) : undefined)}
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                            placeholder={t('videoGen_seed_helper')}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            {t('videoGen_seed_helper')}
                        </p>
                    </div>

                    {/* Submit */}
                    <button
                        onClick={handleSubmit}
                        className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 rounded transition-colors"
                    >
                        🎬 {t('videoGen_generate')}
                    </button>
                </div>
            </div>
        </div>
    );
};
