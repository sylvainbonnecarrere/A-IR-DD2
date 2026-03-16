/**
 * components/workflow/ToolCallBlock.tsx — J9
 *
 * Expandable display block for a single function invocation record.
 * Rendered inside V2AgentNode for messages with sender === 'tool'.
 *
 * Visual spec (collapsed):
 *   🔧 [functionName in cyan-400 bold]           [▼ Détails]
 *
 * Visual spec (expanded):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Input:                                     [📋 Copier]  │
 *   │  { "arg": "value" }                                     │
 *   │ Output:                       [✅ 234ms | ❌ Erreur]    │
 *   │  { "result": "..." }          [📋 Copier]               │
 *   └─────────────────────────────────────────────────────────┘
 */

import React, { useState, useCallback } from 'react';
import type { ToolCallRecord } from '../../types';

export interface ToolCallBlockProps {
    toolCall: ToolCallRecord;
    /** Start expanded (default: false — avoid visual overload). */
    defaultExpanded?: boolean;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface JsonPanelProps {
    label: string;
    data: unknown;
}

const JsonPanel: React.FC<JsonPanelProps> = ({ label, data }) => {
    const [copied, setCopied] = useState(false);

    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [text]);

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</span>
                <button
                    onClick={handleCopy}
                    title="Copier le JSON"
                    className="text-gray-500 hover:text-gray-300 transition-colors p-0.5 rounded"
                >
                    {copied
                        ? <span className="text-green-400 text-xs">✓ Copié</span>
                        : <span className="text-xs">📋</span>
                    }
                </button>
            </div>
            <pre className="text-xs bg-gray-900/60 text-gray-300 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-all border border-gray-700/50">
                {text}
            </pre>
        </div>
    );
};

// ─── Main component ──────────────────────────────────────────────────────────

export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({
    toolCall,
    defaultExpanded = false,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    const isSuccess = toolCall.status === 'success';
    const durationLabel = toolCall.durationMs != null ? `${toolCall.durationMs}ms` : null;

    return (
        <div className="my-1 rounded bg-gray-800/70 border border-cyan-800/40 text-sm">
            {/* Header row */}
            <div className="flex items-center justify-between px-3 py-1.5 select-none">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-400 shrink-0">🔧</span>
                    <span className="font-mono font-bold text-cyan-400 truncate">
                        {toolCall.functionName}
                    </span>
                    <span className={`text-xs shrink-0 ${isSuccess ? 'text-green-400' : 'text-red-400'}`}>
                        {isSuccess ? '✅' : '❌'}
                    </span>
                    {durationLabel && (
                        <span className="text-gray-500 text-xs shrink-0">⏱ {durationLabel}</span>
                    )}
                </div>
                <button
                    onClick={() => setExpanded(prev => !prev)}
                    className="text-gray-400 hover:text-gray-200 transition-colors text-xs ml-2 shrink-0"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Réduire' : 'Développer'}
                >
                    {expanded ? '▲ Réduire' : '▼ Détails'}
                </button>
            </div>

            {/* Expandable body */}
            {expanded && (
                <div className="px-3 pb-3 border-t border-gray-700/50">
                    <JsonPanel label="Input" data={toolCall.arguments} />
                    <JsonPanel label={`Output ${isSuccess ? '(succès)' : '(erreur)'}`} data={toolCall.result} />
                </div>
            )}
        </div>
    );
};

export default ToolCallBlock;
