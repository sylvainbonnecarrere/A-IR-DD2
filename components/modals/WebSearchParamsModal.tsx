import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, ToggleSwitch } from '../UI';
import { CloseIcon } from '../Icons';
import { DEFAULT_WEB_SEARCH_MAX_CONTEXT_TOKENS, defaultWebSearchParams, WebSearchParams, type WebSearchEngine } from '../../types';

const WEB_SEARCH_ENGINES: WebSearchEngine[] = ['duckduckgo.com', 'bing.com', 'google.com', 'baidu.com', 'qwant.com'];

const InfoBadge = ({ text }: { text: string }) => (
  <span
    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-sky-300/30 bg-sky-400/10 text-[10px] font-semibold text-sky-100/90 cursor-help"
    title={text}
    aria-label={text}
  >
    i
  </span>
);

const FieldLabel = ({ label, info }: { label: string; info: string }) => (
  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-200">
    <span>{label}</span>
    <InfoBadge text={info} />
  </span>
);

interface WebSearchParamsModalProps {
  isOpen: boolean;
  agentName: string;
  initialParams?: WebSearchParams;
  isSaving?: boolean;
  onClose: () => void;
  onSave: (params: WebSearchParams) => Promise<void> | void;
}

function normalizeAllowedDomains(rawValue: string): string[] {
  return rawValue
    .split(/,|;/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeWebSearchParams(params?: WebSearchParams): WebSearchParams {
  return {
    ...defaultWebSearchParams,
    ...(params || {}),
  };
}

function clampInteger(value: number, min: number, max?: number): number {
  if (Number.isNaN(value)) {
    return min;
  }

  if (max !== undefined) {
    return Math.min(Math.max(value, min), max);
  }

  return Math.max(value, min);
}

export const WebSearchParamsModal: React.FC<WebSearchParamsModalProps> = ({
  isOpen,
  agentName,
  initialParams,
  isSaving = false,
  onClose,
  onSave,
}) => {
  const [formValues, setFormValues] = useState<WebSearchParams>(normalizeWebSearchParams(initialParams));
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [isMaxContextTokensEnabled, setIsMaxContextTokensEnabled] = useState(Boolean(initialParams?.max_context_tokens));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const nextValues = normalizeWebSearchParams(initialParams);
    if (nextValues.max_context_tokens === undefined) {
      nextValues.max_context_tokens = DEFAULT_WEB_SEARCH_MAX_CONTEXT_TOKENS;
    }
    setFormValues(nextValues);
    setAllowedDomains(nextValues.allowed_domains || []);
    setDomainInput('');
    setIsMaxContextTokensEnabled(initialParams?.max_context_tokens !== undefined);
    setErrorMessage(null);
  }, [initialParams, isOpen]);

  const resolvedValues = useMemo<WebSearchParams>(() => {
    const nextValues: WebSearchParams = {
      ...formValues,
      nb_request_transformation: 1,
      request_list: false,
      allowed_domains: allowedDomains,
    };

    if (!isMaxContextTokensEnabled) {
      delete nextValues.max_context_tokens;
    }

    return nextValues;
  }, [allowedDomains, formValues, isMaxContextTokensEnabled]);

  if (!isOpen) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const updateField = <K extends keyof WebSearchParams>(field: K, value: WebSearchParams[K]) => {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleAddDomain = () => {
    const nextDomains = normalizeAllowedDomains(domainInput);
    if (nextDomains.length === 0) {
      return;
    }

    setAllowedDomains((current) => Array.from(new Set([...current, ...nextDomains])));
    setDomainInput('');
  };

  const handleRemoveDomain = (domain: string) => {
    setAllowedDomains((current) => current.filter((value) => value !== domain));
  };

  const handleSave = async () => {
    if (resolvedValues.web_engine_search && resolvedValues.web_engine_nb_result_select < 1) {
      setErrorMessage('Le Top N du moteur doit etre superieur ou egal a 1.');
      return;
    }

    if (resolvedValues.relevance_threshold < 1 || resolvedValues.relevance_threshold > 10) {
      setErrorMessage('Le seuil de pertinence doit etre compris entre 1 et 10.');
      return;
    }

    setErrorMessage(null);
    await onSave(resolvedValues);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div
        className="bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),linear-gradient(160deg,rgba(5,10,24,0.98),rgba(15,23,42,0.98))] border border-sky-400/30 rounded-2xl shadow-2xl shadow-sky-500/10 overflow-hidden"
        style={{ width: 'min(74vw, 1440px)', maxWidth: 'none', maxHeight: 'calc(100vh - 32px)' }}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-sky-200/20 bg-[linear-gradient(135deg,rgba(9,28,56,0.98),rgba(21,84,130,0.94)_38%,rgba(106,180,219,0.3)_62%,rgba(14,52,86,0.96))] shadow-[inset_0_1px_0_rgba(191,219,254,0.18)]">
          <div className="min-w-0">
            <h2
              className="truncate text-[1.08rem] font-semibold text-sky-50"
              style={{ fontFamily: "'Orbitron', 'Rajdhani', sans-serif" }}
              title={`Paramètres Web Search de l'agent ${agentName}`}
            >
              Paramètres Web Search de l&apos;agent {agentName}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="p-2 h-9 w-9 shrink-0 text-slate-400 hover:text-sky-100 hover:bg-sky-400/10 rounded-lg"
            onClick={onClose}
            disabled={isSaving}
          >
            <CloseIcon width={14} height={14} />
          </Button>
        </div>

        <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: 'calc(100vh - 196px)' }}>
          <div className="w-full p-6 space-y-6">
          {errorMessage && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {errorMessage}
            </div>
          )}

          <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[inset_0_1px_0_rgba(125,211,252,0.08)]">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-200/78">Cadence de recherche</h3>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <label className="space-y-2">
              <FieldLabel label="Top N résultats moteur" info="Limite l'analyse aux premiers résultats fournis par le moteur de recherche sélectionné." />
              <input
                type="number"
                min={1}
                value={formValues.web_engine_nb_result_select}
                onChange={(e) => updateField('web_engine_nb_result_select', clampInteger(parseInt(e.target.value, 10), 1))}
                className="w-full rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2.5 text-slate-100 shadow-inner shadow-black/20"
              />
            </label>

            <label className="space-y-2">
              <FieldLabel label="Nombre max de fragments" info="Nombre maximal de sources ou fragments retenus pour la synthèse finale." />
              <input
                type="number"
                min={1}
                value={formValues.max_uses}
                onChange={(e) => updateField('max_uses', clampInteger(parseInt(e.target.value, 10), 1))}
                className="w-full rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2.5 text-slate-100 shadow-inner shadow-black/20"
              />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel label="Budget max de contexte" info="Limite de sécurité optionnelle pour éviter de saturer le LLM final avec trop de texte." />
                <ToggleSwitch
                  checked={isMaxContextTokensEnabled}
                  onChange={(checked) => {
                    setIsMaxContextTokensEnabled(checked);
                    if (checked && formValues.max_context_tokens === undefined) {
                      updateField('max_context_tokens', DEFAULT_WEB_SEARCH_MAX_CONTEXT_TOKENS);
                    }
                  }}
                />
              </div>
              {isMaxContextTokensEnabled && (
                <input
                  type="number"
                  min={256}
                  value={formValues.max_context_tokens ?? DEFAULT_WEB_SEARCH_MAX_CONTEXT_TOKENS}
                  onChange={(e) => updateField('max_context_tokens', clampInteger(parseInt(e.target.value, 10), 256))}
                  className="w-full rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2.5 text-slate-100 shadow-inner shadow-black/20"
                />
              )}
            </div>

            <label className="space-y-2">
              <FieldLabel label="Seuil de pertinence" info="Tout résultat noté sous ce seuil par le reranker est rejeté." />
              <input
                type="range"
                min={1}
                max={10}
                value={formValues.relevance_threshold}
                onChange={(e) => updateField('relevance_threshold', clampInteger(parseInt(e.target.value, 10), 1, 10))}
                className="w-full"
              />
              <div className="text-xs text-slate-400">{formValues.relevance_threshold}/10</div>
            </label>

            <label className="space-y-2">
              <FieldLabel label="Stratégie de reranking" info="Fast analyse uniquement les snippets, Deep s'appuie sur le contenu approfondi." />
              <select
                value={formValues.rerank_strategy}
                onChange={(e) => updateField('rerank_strategy', e.target.value as WebSearchParams['rerank_strategy'])}
                className="w-full rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2.5 text-slate-100 shadow-inner shadow-black/20"
              >
                <option value="Fast">Fast</option>
                <option value="Deep">Deep</option>
              </select>
            </label>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 space-y-4 shadow-[inset_0_1px_0_rgba(125,211,252,0.08)]">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-200/78">Comportement moteur</h3>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel label="Activer le moteur web" info="Active l'usage d'un moteur de recherche pour la normalized query." />
                <ToggleSwitch
                  checked={formValues.web_engine_search}
                  onChange={(checked) => updateField('web_engine_search', checked)}
                />
              </div>
              {formValues.web_engine_search && (
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel label="Dig snippet" info="Ouvre et analyse chaque URL trouvée pour en extraire un résumé ciblé." />
                  <ToggleSwitch
                    checked={formValues.dig_snippet}
                    onChange={(checked) => updateField('dig_snippet', checked)}
                  />
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 space-y-4 shadow-[inset_0_1px_0_rgba(125,211,252,0.08)]">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-200/78">Portée et langue</h3>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel label="Recherche cross-linguale" info="Génère la requête dans la langue native puis en anglais pour enrichir les sources." />
                <ToggleSwitch
                  checked={formValues.cross_lingual_search}
                  onChange={(checked) => updateField('cross_lingual_search', checked)}
                />
              </div>
              {formValues.web_engine_search && (
              <label className="space-y-2 block">
                <FieldLabel label="Moteur" info="Sélectionne le moteur web utilisé pour la recherche de base." />
                <select
                  value={formValues.web_engine}
                  onChange={(e) => updateField('web_engine', e.target.value as WebSearchParams['web_engine'])}
                  className="w-full rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2.5 text-slate-100 shadow-inner shadow-black/20"
                >
                  {WEB_SEARCH_ENGINES.map((engine) => (
                    <option key={engine} value={engine}>{engine}</option>
                  ))}
                </select>
              </label>
              )}

              <div className="space-y-3 pt-1">
                <FieldLabel label="Domaines autorisés" info="Ajoute des URL ou domaines pour restreindre les recherches à des sources ciblées." />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddDomain();
                      }
                    }}
                    placeholder="example.com"
                    className="h-11 flex-1 rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-2.5 text-slate-100 shadow-inner shadow-black/20"
                  />
                  <Button type="button" variant="ghost" onClick={handleAddDomain} className="h-11 w-11 rounded-xl border border-sky-300/25 bg-sky-400/10 text-sky-100 hover:bg-sky-400/18">+</Button>
                </div>
                {allowedDomains.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {allowedDomains.map((domain) => (
                      <button
                        key={domain}
                        type="button"
                        onClick={() => handleRemoveDomain(domain)}
                        className="rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-xs text-sky-100 hover:bg-sky-400/18"
                        title={`Retirer ${domain}`}
                      >
                        {domain}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[inset_0_1px_0_rgba(125,211,252,0.08)]">
          <label className="space-y-2 block rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[inset_0_1px_0_rgba(125,211,252,0.08)]">
            <FieldLabel label="Query transformation" info="Prompt système chargé de convertir la demande utilisateur en requête de recherche optimisée." />
            <textarea
              rows={10}
              value={formValues.query_transformation}
              onChange={(e) => updateField('query_transformation', e.target.value)}
              className="min-h-[180px] w-full rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-3 text-slate-100 shadow-inner shadow-black/20"
            />
          </label>
          </section>

          <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[inset_0_1px_0_rgba(125,211,252,0.08)]">
            <label className="space-y-2 block">
              <FieldLabel label="Reranking" info="Prompt système du juror chargé d'évaluer la pertinence réelle des sources web candidates." />
              <textarea
                rows={8}
                value={formValues.reranking_prompt}
                onChange={(e) => updateField('reranking_prompt', e.target.value)}
                className="min-h-[200px] w-full rounded-xl bg-slate-900/80 border border-slate-700 px-3 py-3 text-slate-100 shadow-inner shadow-black/20"
              />
            </label>
          </section>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-sky-400/15 bg-slate-950/72">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
            Annuler
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving} className="border border-sky-300/35 bg-[linear-gradient(135deg,rgba(10,37,64,0.98),rgba(14,116,144,0.92)_56%,rgba(125,211,252,0.26))] text-white hover:brightness-110">
            {isSaving ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};