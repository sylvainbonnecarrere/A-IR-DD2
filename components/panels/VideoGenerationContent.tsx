/**
 * 🎬 COMPONENT: VideoGenerationContent
 * 
 * Content component réutilisable pour génération vidéo
 * - Peut être utilisé en SlideOver OU contenu pur
 * - Délégation logique métier et présentation
 */

import React, { useState } from 'react';
import { Button } from '../UI';
import { VideoGenerationOptions, VideoGenerationStatus } from '../../types';
import { useLocalization } from '../../hooks/useLocalization';

interface VideoGenerationContentProps {
  nodeId?: string;
  llmConfigs?: any[];
  onClose: () => void;
  onSubmit: (config: any) => void;
  videoStatus?: VideoGenerationStatus | null;
}

export const VideoGenerationContent: React.FC<VideoGenerationContentProps> = ({
  nodeId,
  llmConfigs,
  onClose,
  onSubmit,
  videoStatus = null
}) => {
  const { t } = useLocalization();
  const isGenerating = videoStatus?.status === 'PROCESSING';

  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<{ mimeType: string; data: string }[]>([]);
  const [resolution, setResolution] = useState<NonNullable<VideoGenerationOptions['resolution']>>('1080p');
  const [aspectRatio, setAspectRatio] = useState<NonNullable<VideoGenerationOptions['aspectRatio']>>('16:9');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];

    // Max 3 images
    if (referenceImages.length + files.length > 3) {
      alert('Maximum 3 reference images allowed');
      return;
    }

    // Convert files to base64
    files.forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setReferenceImages(prev => [...prev, {
          mimeType: file.type,
          data: base64
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = () => {
    if (!prompt.trim()) {
      alert('Please enter a video prompt');
      return;
    }

    const options: VideoGenerationOptions = {
      prompt: prompt.trim(),
      mode: referenceImages.length > 0 ? 'with-references' : 'text-to-video',
      referenceImages: referenceImages.length > 0
        ? referenceImages.map((image) => ({
            image,
            referenceType: 'asset' as const,
          }))
        : undefined,
      resolution,
      aspectRatio
    };

    onSubmit(options);
  };

  return (
    <div className="space-y-4">
      {/* Video Status Progress */}
      {videoStatus && (
        <div className="bg-gradient-to-r from-purple-900/30 to-cyan-900/30 border border-cyan-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-cyan-300">
              {videoStatus.status === 'PROCESSING' && '⏳ Generating...'}
              {videoStatus.status === 'COMPLETED' && '✅ Completed'}
              {videoStatus.status === 'FAILED' && '❌ Failed'}
            </span>
            <span className="text-xs text-gray-400">
              {videoStatus.progress || 0}%
            </span>
          </div>
          {videoStatus.status === 'PROCESSING' && (
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-cyan-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${videoStatus.progress || 0}%` }}
              />
            </div>
          )}
          {videoStatus.status === 'COMPLETED' && videoStatus.videoUrl && (
            <a
              href={videoStatus.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-cyan-400 hover:text-cyan-300 underline mt-2 block"
            >
              📥 Download Video
            </a>
          )}
          {videoStatus.status === 'FAILED' && videoStatus.error && (
            <p className="text-sm text-red-400 mt-1">{videoStatus.error}</p>
          )}
        </div>
      )}

      {/* Prompt */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Video Prompt *
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the video you want to generate... (e.g., 'A futuristic city at sunset with flying cars')"
          className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white 
                     placeholder-gray-400 resize-none
                     focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 focus:outline-none"
          rows={4}
          disabled={isGenerating}
        />
      </div>

      {/* Reference Images */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Reference Images (Optional, max 3)
        </label>

        {referenceImages.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-2">
            {referenceImages.map((img, index) => (
              <div key={index} className="relative group">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={`Reference ${index + 1}`}
                  className="w-full h-24 object-cover rounded border-2 border-gray-600"
                />
                <button
                  onClick={() => handleRemoveImage(index)}
                  className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white 
                             rounded-full w-6 h-6 flex items-center justify-center
                             opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {referenceImages.length < 3 && (
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileUpload}
            disabled={isGenerating}
            className="w-full text-sm text-gray-400
                       file:mr-4 file:py-2 file:px-4
                       file:rounded file:border-0
                       file:text-sm file:font-semibold
                       file:bg-cyan-600 file:text-white
                       hover:file:bg-cyan-700
                       cursor-pointer"
          />
        )}
        <p className="text-xs text-gray-500 mt-1">
          {referenceImages.length}/3 images added
        </p>
      </div>

      {/* Resolution */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Resolution
        </label>
        <select
          value={resolution}
          onChange={(e) => setResolution(e.target.value as NonNullable<VideoGenerationOptions['resolution']>)}
          disabled={isGenerating}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white
                     focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 focus:outline-none"
        >
          <option value="720p">720p (HD)</option>
          <option value="1080p">1080p (Full HD)</option>
          <option value="4k" disabled>4K (bientot)</option>
        </select>
      </div>

      {/* Aspect Ratio */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Aspect Ratio
        </label>
        <select
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value as NonNullable<VideoGenerationOptions['aspectRatio']>)}
          disabled={isGenerating}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg p-2 text-white
                     focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 focus:outline-none"
        >
          <option value="16:9">16:9 (Widescreen)</option>
          <option value="9:16">9:16 (Vertical / Mobile)</option>
          <option value="1:1" disabled>1:1 (bientot)</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={isGenerating}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="bg-cyan-600 hover:bg-cyan-700"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </>
          ) : (
            '🎬 Generate Video'
          )}
        </Button>
      </div>
    </div>
  );
};
