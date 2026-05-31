import React, { useMemo } from 'react';
import { LLMCapability, LLMProvider } from '../types';
import { getDisplayableNativeFunctions } from '../utils/llmNativeFunctionCatalog';

interface LLMNativeFunctionsPanelProps {
    llmProvider: LLMProvider;
    model?: string;
    capabilities?: LLMCapability[];
    availableCapabilities?: LLMCapability[];
    onChangeSelectedCapabilities?: (capabilities: LLMCapability[]) => void;
    emptyMessage?: string;
}

export const LLMNativeFunctionsPanel: React.FC<LLMNativeFunctionsPanelProps> = ({
    llmProvider,
    model,
    capabilities = [],
    availableCapabilities,
    onChangeSelectedCapabilities,
    emptyMessage = 'Aucune fonction provider/cloud active.',
}) => {
    const isSelectable = Array.isArray(availableCapabilities) && typeof onChangeSelectedCapabilities === 'function';
    const selectedCapabilitySet = useMemo(() => new Set(capabilities), [capabilities]);
    const nativeFunctions = useMemo(
        () => getDisplayableNativeFunctions(
            availableCapabilities
                ? [...availableCapabilities, ...capabilities.filter((capability) => !availableCapabilities.includes(capability))]
                : capabilities,
            llmProvider,
        ),
        [availableCapabilities, capabilities, llmProvider],
    );
    const activeNativeFunctionCount = useMemo(
        () => nativeFunctions.filter((nativeFunction) => selectedCapabilitySet.has(nativeFunction.capability)).length,
        [nativeFunctions, selectedCapabilitySet],
    );

    const handleToggle = (capability: LLMCapability) => {
        if (!isSelectable || !onChangeSelectedCapabilities) {
            return;
        }

        const nextCapabilities = selectedCapabilitySet.has(capability)
            ? capabilities.filter((entry) => entry !== capability)
            : [...capabilities, capability];

        onChangeSelectedCapabilities([...new Set(nextCapabilities)]);
    };

    return (
        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 h-full">
            <div className="mb-4">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">Fonctions provider/cloud</h3>
                    <span className="rounded-full border border-gray-600 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-300">
                        {isSelectable ? `${activeNativeFunctionCount}/${nativeFunctions.length}` : nativeFunctions.length}
                    </span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                    {isSelectable
                        ? "Selectionnez les fonctions natives du provider a activer pour cette instance."
                        : "Derivees automatiquement des fonctionnalites LLM actives sur le prototype ou l'instance."}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-400">
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-300">
                        {llmProvider}
                    </span>
                    {model && (
                        <span className="rounded-full border border-gray-600 bg-gray-800/70 px-2 py-0.5 text-gray-300">
                            {model}
                        </span>
                    )}
                </div>
            </div>

            <div className="max-h-[34rem] overflow-y-auto pr-2 space-y-2">
                {nativeFunctions.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-700 bg-gray-950/40 px-3 py-4 text-sm text-gray-500">
                        {emptyMessage}
                    </div>
                ) : (
                    nativeFunctions.map((nativeFunction) => {
                        const isSelected = selectedCapabilitySet.has(nativeFunction.capability);

                        if (isSelectable) {
                            return (
                                <button
                                    key={nativeFunction.capability}
                                    type="button"
                                    role="checkbox"
                                    aria-checked={isSelected}
                                    aria-label={nativeFunction.name}
                                    onClick={() => handleToggle(nativeFunction.capability)}
                                    className={`w-full rounded-lg border p-3 text-left transition-colors ${isSelected
                                        ? 'border-cyan-500/70 bg-cyan-950/30 hover:bg-cyan-950/40'
                                        : 'border-gray-700/70 bg-gray-950/40 hover:border-gray-600 hover:bg-gray-900/60'
                                        }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 ${isSelected
                                            ? 'border-cyan-400 bg-cyan-500 text-white'
                                            : 'border-gray-500 bg-transparent text-transparent'
                                            }`}>
                                            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 12 12">
                                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-3">
                                                <h4 className="text-sm font-medium text-white">{nativeFunction.name}</h4>
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isSelected
                                                    ? 'border border-cyan-400/40 bg-cyan-500/15 text-cyan-200'
                                                    : 'border border-gray-600 bg-gray-800/70 text-gray-400'
                                                    }`}>
                                                    {isSelected ? 'active' : 'inactive'}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-xs leading-5 text-gray-400">{nativeFunction.description}</p>
                                        </div>
                                    </div>
                                </button>
                            );
                        }

                        return (
                            <div
                                key={nativeFunction.capability}
                                className="rounded-lg border border-gray-700/70 bg-gray-950/40 p-3"
                            >
                                <h4 className="text-sm font-medium text-white">{nativeFunction.name}</h4>
                                <p className="mt-1 text-xs leading-5 text-gray-400">{nativeFunction.description}</p>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};