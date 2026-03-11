import React, { useEffect, useState, useMemo } from 'react';
import { useFunctionStore } from '../stores/useFunctionStore';
import type { FunctionLanguage, FunctionOrigin } from '../types/function.types';

interface FunctionSelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  readOnly?: boolean;
}

const LANG_BADGE: Record<FunctionLanguage, string> = {
  python: 'bg-blue-900/60 text-blue-300 border border-blue-700',
  typescript: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
};

const ORIGIN_BADGE: Record<FunctionOrigin, string> = {
  native: 'bg-violet-900/60 text-violet-300 border border-violet-700',
  custom: 'bg-cyan-900/60 text-cyan-300 border border-cyan-700',
};

export const FunctionSelector: React.FC<FunctionSelectorProps> = ({ selectedIds, onChange, readOnly = false }) => {
  const { functions, isLoading, loadFunctions } = useFunctionStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadFunctions();
  }, [loadFunctions]);

  const enabledFunctions = useMemo(
    () => functions.filter(f => f.isEnabled),
    [functions]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return enabledFunctions;
    return enabledFunctions.filter(
      f =>
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [enabledFunctions, search]);

  const handleToggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(sid => sid !== id)
        : [...selectedIds, id]
    );
  };

  if (isLoading && functions.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
        Chargement des fonctions...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          <span className="text-cyan-400 font-semibold">{selectedIds.length}</span> fonction{selectedIds.length !== 1 ? 's' : ''} sélectionnée{selectedIds.length !== 1 ? 's' : ''}
          {readOnly && <span className="ml-2 text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">lecture seule</span>}
        </p>
        {!readOnly && selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors"
          >
            Tout désélectionner
          </button>
        )}
      </div>

      {/* Search — hidden in readOnly mode */}
      {!readOnly && (
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher une fonction..."
          className="w-full p-2 text-sm bg-gray-800 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500/50 text-gray-200 placeholder-gray-500"
        />
      )}

      {/* Function list */}
      <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">
            {search ? 'Aucune fonction ne correspond à la recherche.' : 'Aucune fonction disponible.'}
          </p>
        )}
        {filtered.map(fn => {
          const isSelected = selectedIds.includes(fn._id);
          return (
            <button
              key={fn._id}
              type="button"
              onClick={() => !readOnly && handleToggle(fn._id)}
              className={`w-full flex items-start gap-3 p-2.5 rounded-lg text-left transition-colors border ${readOnly ? 'cursor-default ' : ''}${
                isSelected
                  ? 'bg-cyan-950/50 border-cyan-600/60 hover:bg-cyan-950/70'
                  : 'bg-gray-900/50 border-gray-700/50 hover:bg-gray-800/60 hover:border-gray-600'
              }`}
            >
              {/* Checkbox indicator */}
              <div
                className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                  isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-gray-500'
                }`}
              >
                {isSelected && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${isSelected ? 'text-cyan-300' : 'text-gray-200'}`}>
                    {fn.name}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${LANG_BADGE[fn.language]}`}>
                    {fn.language}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${ORIGIN_BADGE[fn.origin]}`}>
                    {fn.origin}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{fn.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Info note */}
      {!readOnly && (
        <p className="text-xs text-gray-500 pt-1">
          Gérez les fonctions disponibles depuis la page Phil → Fonctions.
        </p>
      )}
    </div>
  );
};
