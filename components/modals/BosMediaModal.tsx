import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLocalization } from '@/hooks/useLocalization';
import {
  workflowMediaExplorerService,
  WorkflowMediaExplorerItem,
  WorkflowMediaSortBy,
  WorkflowMediaSortOrder,
  WorkflowMediaStorageMode,
} from '@/services/workflowMediaExplorerService';

interface BosMediaModalProps {
  isOpen: boolean;
  workflowId: string | null;
  workflowName?: string | null;
  onClose: () => void;
}

type SortValue = 'updatedAt:desc' | 'updatedAt:asc' | 'name:asc' | 'size:desc';
type MediaAction = 'preview' | 'download' | 'delete';
type OrphanFilterValue = 'exclude' | 'include' | 'only';

interface PreviewState {
  item: WorkflowMediaExplorerItem;
  objectUrl: string;
  textContent: string | null;
  mimeType: string;
}

const EMPTY_COUNTS: Record<WorkflowMediaStorageMode, number> = {
  db: 0,
  workspace: 0,
  cloud: 0,
};

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} o`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} Ko`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function canRenderPreview(mimeType: string): boolean {
  return mimeType.startsWith('image/')
    || mimeType.startsWith('video/')
    || mimeType.startsWith('audio/')
    || mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/pdf';
}

function isTextLikeMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') || mimeType === 'application/json';
}

async function readBlobAsText(blob: Blob): Promise<string> {
  const blobWithText = blob as Blob & {
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };

  if (typeof blobWithText.text === 'function') {
    return blobWithText.text();
  }

  if (typeof blobWithText.arrayBuffer === 'function') {
    const buffer = await blobWithText.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read text preview.'));
      reader.readAsText(blob);
    });
  }

  throw new Error('Text preview not supported for this environment.');
}

const BosMediaModal: React.FC<BosMediaModalProps> = ({
  isOpen,
  workflowId,
  workflowName,
  onClose,
}) => {
  const { t } = useLocalization();
  const { isAuthenticated, accessToken } = useAuth();
  const [activeTab, setActiveTab] = useState<WorkflowMediaStorageMode>('workspace');
  const [search, setSearch] = useState('');
  const [orphanFilter, setOrphanFilter] = useState<OrphanFilterValue>('include');
  const [sortValue, setSortValue] = useState<SortValue>('updatedAt:desc');
  const [items, setItems] = useState<WorkflowMediaExplorerItem[]>([]);
  const [counts, setCounts] = useState<Record<WorkflowMediaStorageMode, number>>(EMPTY_COUNTS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<{ itemId: string; action: MediaAction } | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab('workspace');
    setSearch('');
    setOrphanFilter('include');
    setSortValue('updatedAt:desc');
    setFeedback(null);
    setPreviewState(null);
  }, [isOpen, workflowId]);

  useEffect(() => {
    return () => {
      if (previewState?.objectUrl) {
        window.URL.revokeObjectURL(previewState.objectUrl);
      }
    };
  }, [previewState]);

  useEffect(() => {
    if (!isOpen || !workflowId) {
      return;
    }

    if (!isAuthenticated || !accessToken) {
      setItems([]);
      setCounts(EMPTY_COUNTS);
      setError(t('bos_media_auth_required', 'Connexion requise pour consulter les medias du workflow.'));
      return;
    }

    let isCancelled = false;

    const loadMedia = async () => {
      setIsLoading(true);
      setError(null);
      setFeedback(null);

      const [sortBy, sortOrder] = sortValue.split(':') as [WorkflowMediaSortBy, WorkflowMediaSortOrder];

      try {
        const response = await workflowMediaExplorerService.getWorkflowMedia(workflowId, {
          token: accessToken,
          q: search,
          includeOrphans: orphanFilter !== 'exclude',
          sortBy,
          sortOrder,
        });

        if (isCancelled) {
          return;
        }

        setItems(response.data);
        setCounts(response.meta.counts ?? EMPTY_COUNTS);
      } catch (err) {
        if (isCancelled) {
          return;
        }

        const errorMessage = err instanceof Error
          ? err.message
          : t('bos_media_loading_error', 'Chargement des medias impossible.');

        setItems([]);
        setCounts(EMPTY_COUNTS);
        setError(errorMessage);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadMedia();

    return () => {
      isCancelled = true;
    };
  }, [accessToken, isAuthenticated, isOpen, orphanFilter, search, sortValue, t, workflowId]);

  const replacePreview = (nextPreview: PreviewState | null) => {
    setPreviewState((currentPreview) => {
      if (currentPreview?.objectUrl) {
        window.URL.revokeObjectURL(currentPreview.objectUrl);
      }

      return nextPreview;
    });
  };

  const handlePreview = async (item: WorkflowMediaExplorerItem) => {
    if (!accessToken) {
      setFeedback(t('bos_media_auth_required', 'Connexion requise pour consulter les medias du workflow.'));
      return;
    }

    setActiveAction({ itemId: item.mediaId, action: 'preview' });
    setFeedback(null);

    try {
      const blob = await workflowMediaExplorerService.getMediaBlob(item.mediaId, { token: accessToken });
      const mimeType = blob.type || item.mimeType;
      const objectUrl = window.URL.createObjectURL(blob);
      const textContent = isTextLikeMimeType(mimeType) ? await readBlobAsText(blob) : null;

      replacePreview({
        item,
        objectUrl,
        textContent,
        mimeType,
      });
    } catch (err) {
      replacePreview(null);
      setFeedback(err instanceof Error ? err.message : t('bos_media_preview_error', 'Aperçu indisponible.'));
    } finally {
      setActiveAction(null);
    }
  };

  const handleDownload = async (item: WorkflowMediaExplorerItem) => {
    if (!accessToken) {
      setFeedback(t('bos_media_auth_required', 'Connexion requise pour consulter les medias du workflow.'));
      return;
    }

    setActiveAction({ itemId: item.mediaId, action: 'download' });
    setFeedback(null);

    try {
      const blob = await workflowMediaExplorerService.getMediaBlob(item.mediaId, {
        token: accessToken,
        download: true,
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = item.originalName || item.displayName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t('bos_media_download_error', 'Telechargement impossible.'));
    } finally {
      setActiveAction(null);
    }
  };

  const handleDelete = async (item: WorkflowMediaExplorerItem) => {
    if (!accessToken) {
      setFeedback(t('bos_media_auth_required', 'Connexion requise pour consulter les medias du workflow.'));
      return;
    }

    const confirmed = window.confirm(
      t('bos_media_delete_confirm', `Supprimer définitivement ${item.originalName} ?`),
    );

    if (!confirmed) {
      return;
    }

    setActiveAction({ itemId: item.mediaId, action: 'delete' });
    setFeedback(null);

    try {
      await workflowMediaExplorerService.deleteMedia(item.mediaId, { token: accessToken });
      setItems((currentItems) => currentItems.filter((candidate) => candidate.mediaId !== item.mediaId));
      setCounts((currentCounts) => ({
        ...currentCounts,
        [item.storageMode]: Math.max(0, (currentCounts[item.storageMode] ?? 0) - 1),
      }));
      if (previewState?.item.mediaId === item.mediaId) {
        replacePreview(null);
      }
      setFeedback(t('bos_media_delete_success', 'Media supprimé du catalogue et de son stockage primaire.'));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t('bos_media_delete_error', 'Suppression impossible.'));
    } finally {
      setActiveAction(null);
    }
  };

  const renderPreviewContent = () => {
    if (!previewState) {
      return null;
    }

    if (previewState.mimeType.startsWith('image/')) {
      return <img src={previewState.objectUrl} alt={previewState.item.originalName} className="max-h-[60vh] w-full rounded-xl object-contain" />;
    }

    if (previewState.mimeType.startsWith('video/')) {
      return <video src={previewState.objectUrl} controls className="max-h-[60vh] w-full rounded-xl bg-black" />;
    }

    if (previewState.mimeType.startsWith('audio/')) {
      return <audio src={previewState.objectUrl} controls className="w-full" />;
    }

    if (previewState.mimeType === 'application/pdf') {
      return <iframe src={previewState.objectUrl} title={previewState.item.originalName} className="h-[60vh] w-full rounded-xl bg-white" />;
    }

    if (previewState.textContent !== null) {
      return (
        <pre className="max-h-[60vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-200">
          {previewState.textContent}
        </pre>
      );
    }

    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950 p-6 text-sm text-slate-400">
        {t('bos_media_preview_not_supported', 'Aperçu intégré indisponible pour ce type de fichier.')}
      </div>
    );
  };

  if (!isOpen || !workflowId) {
    return null;
  }

  const visibleItems = items.filter((item) => {
    if (item.storageMode !== activeTab) {
      return false;
    }

    if (orphanFilter === 'exclude') {
      return !item.isOrphan;
    }

    if (orphanFilter === 'only') {
      return item.isOrphan;
    }

    return true;
  });
  const visibleOrphanCount = visibleItems.filter((item) => item.isOrphan).length;
  const tabs: Array<{ id: WorkflowMediaStorageMode; label: string }> = [
    { id: 'db', label: t('bos_media_tab_db', 'BDD') },
    { id: 'workspace', label: t('bos_media_tab_workspace', 'Workspace') },
    { id: 'cloud', label: t('bos_media_tab_cloud', 'Cloud') },
  ];
  const orphanFilterSummary = orphanFilter === 'only'
    ? t('bos_media_orphan_filter_only_summary', 'Vue orphelins uniquement')
    : orphanFilter === 'include'
      ? t('bos_media_orphan_filter_include_summary', 'Orphelins inclus')
      : t('bos_media_orphan_filter_exclude_summary', 'Orphelins masques');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-950 shadow-[0_32px_120px_rgba(15,23,42,0.55)]">
        <div className="border-b border-slate-800 bg-slate-900/90 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-cyan-300/70">
                {t('bos_media_kicker', 'Livraison BOS Media')}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-50">
                {t('bos_media_title', 'Media du workflow')}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {workflowName
                  ? `${t('bos_media_workflow_label', 'Workflow actif')} : ${workflowName}`
                  : t('bos_media_workflow_missing', 'Aucun workflow actif selectionne.')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              {t('bos_media_close', 'Fermer')}
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full border px-4 py-2 text-sm transition ${activeTab === tab.id
                  ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white'}`}
              >
                {tab.label} ({counts[tab.id] ?? 0})
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('bos_media_search_placeholder', 'Rechercher un media, un agent ou un type MIME')}
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
            />
            <select
              value={orphanFilter}
              aria-label={t('bos_media_orphan_filter_label', 'Filtre orphelins')}
              onChange={(event) => setOrphanFilter(event.target.value as OrphanFilterValue)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
            >
              <option value="exclude">{t('bos_media_orphan_filter_exclude', 'Masquer les orphelins')}</option>
              <option value="include">{t('bos_media_orphan_filter_include', 'Inclure les orphelins')}</option>
              <option value="only">{t('bos_media_orphan_filter_only', 'Seulement les orphelins')}</option>
            </select>
            <select
              value={sortValue}
              onChange={(event) => setSortValue(event.target.value as SortValue)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
            >
              <option value="updatedAt:desc">{t('bos_media_sort_recent', 'Plus recent')}</option>
              <option value="updatedAt:asc">{t('bos_media_sort_oldest', 'Plus ancien')}</option>
              <option value="name:asc">{t('bos_media_sort_name', 'Nom A-Z')}</option>
              <option value="size:desc">{t('bos_media_sort_size', 'Taille decroissante')}</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-100">
              {orphanFilterSummary}
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">
              {visibleOrphanCount} {t('bos_media_orphan_visible_count', 'orphelin(s) visible(s)')}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {feedback ? (
            <div className="mb-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
              {feedback}
            </div>
          ) : null}
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-400">
              {t('bos_media_loading', 'Chargement du catalogue media...')}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-6 py-10 text-center text-sm text-slate-400">
              {t('bos_media_empty_state', 'Aucun media ne correspond a cet onglet pour le moment.')}
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {visibleItems.map((item) => (
                <article
                  key={item.mediaId}
                  className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.22)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-50">{item.originalName}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.24em] text-slate-500">{item.mimeType}</p>
                    </div>
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                      {formatBytes(item.size)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-slate-300">
                    <p>
                      <span className="text-slate-500">{t('bos_media_source_label', 'Source')}</span> {item.canonicalLocator}
                    </p>
                    <p>
                      <span className="text-slate-500">{t('bos_media_agent_label', 'Agent')}</span> {item.lastModifiedByAgentName || item.createdByAgentName || t('bos_media_unknown_agent', 'Inconnu')}
                    </p>
                    <p>
                      <span className="text-slate-500">{t('bos_media_updated_label', 'Mise a jour')}</span> {formatDate(item.updatedAt)}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handlePreview(item)}
                      disabled={activeAction?.itemId === item.mediaId}
                      className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activeAction?.itemId === item.mediaId && activeAction.action === 'preview'
                        ? t('bos_media_action_loading', 'Traitement...')
                        : t('bos_media_action_preview', canRenderPreview(item.mimeType) ? 'Apercu' : 'Ouvrir')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(item)}
                      disabled={activeAction?.itemId === item.mediaId}
                      className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activeAction?.itemId === item.mediaId && activeAction.action === 'download'
                        ? t('bos_media_action_loading', 'Traitement...')
                        : t('bos_media_action_download', 'Telecharger')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      disabled={activeAction?.itemId === item.mediaId}
                      className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activeAction?.itemId === item.mediaId && activeAction.action === 'delete'
                        ? t('bos_media_action_loading', 'Traitement...')
                        : t('bos_media_action_delete', 'Supprimer')}
                    </button>
                  </div>

                  {item.isOrphan ? (
                    <div className="mt-4 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-100">
                      {t('bos_media_orphan_badge', 'Orphelin')} {item.orphanReason ? `· ${item.orphanReason}` : ''}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        {previewState ? (
          <div className="border-t border-slate-800 bg-slate-950/95 px-6 py-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/70">
                  {t('bos_media_preview_label', 'Apercu actif')}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-50">{previewState.item.originalName}</h3>
                <p className="mt-1 text-sm text-slate-400">{previewState.mimeType}</p>
              </div>
              <button
                type="button"
                onClick={() => replacePreview(null)}
                className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                {t('bos_media_preview_close', 'Fermer l\'apercu')}
              </button>
            </div>
            {renderPreviewContent()}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BosMediaModal;