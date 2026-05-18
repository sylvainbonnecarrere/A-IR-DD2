import React, { useId, useMemo, useState } from 'react';
import type { Tool } from '../types';

interface ProviderToolsPanelProps {
  tools?: Tool[];
  onChange?: (tools: Tool[]) => void;
  title?: string;
  description?: string;
  emptyMessage?: string;
  addButtonLabel?: string;
}

const DEFAULT_PARAMETERS_TEXT = '{\n  "type": "object"\n}';

function normalizeTool(candidate: Partial<Tool>): Tool | null {
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';

  if (name.length === 0) {
    return null;
  }

  return {
    name,
    description: typeof candidate.description === 'string' ? candidate.description : '',
    parameters: candidate.parameters && typeof candidate.parameters === 'object' && !Array.isArray(candidate.parameters)
      ? candidate.parameters
      : { type: 'object' },
    ...(candidate.outputSchema && typeof candidate.outputSchema === 'object' && !Array.isArray(candidate.outputSchema)
      ? { outputSchema: candidate.outputSchema }
      : {}),
  };
}

function stringifySchema(schema: unknown, fallback: string): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return fallback;
  }

  return JSON.stringify(schema, null, 2);
}

function parseSchema(text: string, fieldLabel: string): { value?: Record<string, unknown>; error?: string } {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${fieldLabel} doit contenir un objet JSON.` };
    }

    return { value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      error: `${fieldLabel} contient un JSON invalide.${error instanceof Error && error.message ? ` ${error.message}` : ''}`,
    };
  }
}

export const ProviderToolsPanel: React.FC<ProviderToolsPanelProps> = ({
  tools = [],
  onChange,
  title = 'Fonctions provider/cloud',
  description,
  emptyMessage = "Aucune fonction provider/cloud n'est configuree pour cette cible.",
  addButtonLabel = 'Ajouter la fonction provider/cloud',
}) => {
  const panelId = useId();
  const isEditable = typeof onChange === 'function';
  const normalizedTools = useMemo(
    () => tools.flatMap((tool) => {
      const normalized = normalizeTool(tool);
      return normalized ? [normalized] : [];
    }),
    [tools],
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftParametersText, setDraftParametersText] = useState(DEFAULT_PARAMETERS_TEXT);
  const [draftOutputSchemaText, setDraftOutputSchemaText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const resetDraft = () => {
    setEditingIndex(null);
    setDraftName('');
    setDraftDescription('');
    setDraftParametersText(DEFAULT_PARAMETERS_TEXT);
    setDraftOutputSchemaText('');
    setFormError(null);
  };

  const handleEdit = (index: number) => {
    const tool = normalizedTools[index];
    if (!tool) {
      return;
    }

    setEditingIndex(index);
    setDraftName(tool.name);
    setDraftDescription(tool.description || '');
    setDraftParametersText(stringifySchema(tool.parameters, DEFAULT_PARAMETERS_TEXT));
    setDraftOutputSchemaText(tool.outputSchema ? stringifySchema(tool.outputSchema, '') : '');
    setFormError(null);
  };

  const handleSubmit = () => {
    if (!onChange) {
      return;
    }

    const name = draftName.trim();
    if (name.length === 0) {
      setFormError('Le nom de la fonction provider/cloud est obligatoire.');
      return;
    }

    const parsedParameters = parseSchema(draftParametersText, 'Le schema d entree');
    if (parsedParameters.error) {
      setFormError(parsedParameters.error);
      return;
    }

    const parsedOutputSchema = parseSchema(draftOutputSchemaText, 'Le schema de sortie');
    if (parsedOutputSchema.error) {
      setFormError(parsedOutputSchema.error);
      return;
    }

    const nextTool: Tool = {
      name,
      description: draftDescription.trim(),
      parameters: parsedParameters.value ?? { type: 'object' },
      ...(parsedOutputSchema.value ? { outputSchema: parsedOutputSchema.value } : {}),
    };

    const nextTools = editingIndex === null
      ? [...normalizedTools, nextTool]
      : normalizedTools.map((tool, index) => (index === editingIndex ? nextTool : tool));

    onChange(nextTools);
    resetDraft();
  };

  const handleDelete = (index: number) => {
    if (!onChange) {
      return;
    }

    onChange(normalizedTools.filter((_, candidateIndex) => candidateIndex !== index));
    if (editingIndex === index) {
      resetDraft();
    }
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {description ? <p className="mt-1 text-xs text-gray-400">{description}</p> : null}
        </div>
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-200">
          {normalizedTools.length}
        </span>
      </div>

      {isEditable ? (
        <div className="mt-4 rounded-lg border border-gray-700/80 bg-gray-950/50 p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${panelId}-tool-name`} className="block text-xs font-medium text-gray-300 mb-1">
                Nom provider/cloud
              </label>
              <input
                id={`${panelId}-tool-name`}
                type="text"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="provider_function_name"
                className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor={`${panelId}-tool-description`} className="block text-xs font-medium text-gray-300 mb-1">
                Description
              </label>
              <input
                id={`${panelId}-tool-description`}
                type="text"
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                placeholder="Decrit le role de la fonction provider/cloud"
                className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${panelId}-tool-parameters`} className="block text-xs font-medium text-gray-300 mb-1">
              Schema d entree JSON
            </label>
            <textarea
              id={`${panelId}-tool-parameters`}
              value={draftParametersText}
              onChange={(event) => setDraftParametersText(event.target.value)}
              rows={7}
              className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor={`${panelId}-tool-output-schema`} className="block text-xs font-medium text-gray-300 mb-1">
              Schema de sortie JSON optionnel
            </label>
            <textarea
              id={`${panelId}-tool-output-schema`}
              value={draftOutputSchemaText}
              onChange={(event) => setDraftOutputSchemaText(event.target.value)}
              rows={5}
              placeholder="Laissez vide si le provider ne renvoie pas de schema formel."
              className="w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {formError ? (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {formError}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            {editingIndex !== null ? (
              <button
                type="button"
                onClick={resetDraft}
                className="rounded-md border border-gray-600 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white"
              >
                Annuler
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSubmit}
              className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20"
            >
              {editingIndex === null ? addButtonLabel : 'Mettre a jour la fonction provider/cloud'}
            </button>
          </div>
        </div>
      ) : null}

      {normalizedTools.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-700 px-4 py-5 text-sm text-gray-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="mt-4 max-h-80 overflow-y-auto space-y-3 pr-1">
          {normalizedTools.map((tool, index) => (
            <div
              key={`${tool.name}-${index}`}
              className="rounded-lg border border-gray-700/80 bg-gray-950/60 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-indigo-200">{tool.name}</span>
                    <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-indigo-100">
                      provider
                    </span>
                    <span className="rounded-full border border-slate-600 bg-slate-800/70 px-2 py-0.5 text-[10px] text-slate-200">
                      schema entree
                    </span>
                    {tool.outputSchema ? (
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">
                        schema sortie
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    {tool.description?.trim() || 'Sans description fournie.'}
                  </p>
                </div>

                {isEditable ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(index)}
                      aria-label={`Modifier la fonction provider/cloud ${tool.name}`}
                      className="rounded-md border border-gray-600 px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-cyan-400 hover:text-cyan-100"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(index)}
                      aria-label={`Supprimer la fonction provider/cloud ${tool.name}`}
                      className="rounded-md border border-rose-500/30 px-2 py-1 text-[11px] font-medium text-rose-200 transition hover:border-rose-400 hover:text-white"
                    >
                      Supprimer
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};