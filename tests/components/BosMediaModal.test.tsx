import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BosMediaModal from '../../components/modals/BosMediaModal';
import { useAuth } from '../../hooks/useAuth';
import { useLocalization } from '../../hooks/useLocalization';
import { workflowMediaExplorerService } from '../../services/workflowMediaExplorerService';

jest.mock('../../hooks/useAuth');
jest.mock('../../hooks/useLocalization');
jest.mock('../../services/workflowMediaExplorerService', () => ({
  workflowMediaExplorerService: {
    getWorkflowMedia: jest.fn(),
    getMediaBlob: jest.fn(),
    deleteMedia: jest.fn(),
  },
}));

const createObjectURLMock = jest.fn(() => 'blob://preview-url');
const revokeObjectURLMock = jest.fn();
const anchorClickMock = jest.fn();

const mediaFixtures = [
  {
    mediaId: 'media-db',
    workflowId: 'wf-1',
    storageMode: 'db',
    provenance: null,
    sourceExecutionId: null,
    canonicalLocator: 'journal://123',
    displayName: 'database-note.txt',
    originalName: 'database-note.txt',
    mimeType: 'text/plain',
    size: 10,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
    createdByAgentId: 'agent-1',
    createdByAgentName: 'DB Agent',
    lastModifiedByAgentId: 'agent-1',
    lastModifiedByAgentName: 'DB Agent',
    isOrphan: false,
    orphanReason: null,
  },
  {
    mediaId: 'media-workspace',
    workflowId: 'wf-1',
    storageMode: 'workspace',
    provenance: 'runtime_output',
    sourceExecutionId: 'utr-bos-runtime-1',
    canonicalLocator: 'workspace://output/media/agents/agent-1/2026-05/workspace-note.txt',
    displayName: 'workspace-note.txt',
    originalName: 'workspace-note.txt',
    mimeType: 'text/plain',
    size: 20,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-16T11:00:00.000Z',
    createdByAgentId: 'agent-1',
    createdByAgentName: 'Workspace Agent',
    lastModifiedByAgentId: 'agent-1',
    lastModifiedByAgentName: 'Workspace Agent',
    isOrphan: false,
    orphanReason: null,
  },
  {
    mediaId: 'media-cloud',
    workflowId: 'wf-1',
    storageMode: 'cloud',
    provenance: null,
    sourceExecutionId: null,
    canonicalLocator: 's3://bucket/cloud-note.txt',
    displayName: 'cloud-note.txt',
    originalName: 'cloud-note.txt',
    mimeType: 'text/plain',
    size: 30,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-16T12:00:00.000Z',
    createdByAgentId: 'agent-1',
    createdByAgentName: 'Cloud Agent',
    lastModifiedByAgentId: 'agent-1',
    lastModifiedByAgentName: 'Cloud Agent',
    isOrphan: true,
    orphanReason: 'manual_detach',
  },
];

describe('BosMediaModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window.URL, 'createObjectURL', {
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      writable: true,
      value: revokeObjectURLMock,
    });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClickMock);

    (useAuth as unknown as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-123',
    });

    (useLocalization as unknown as jest.Mock).mockReturnValue({
      t: (key: string, fallback?: string) => fallback || key,
    });

    (workflowMediaExplorerService.getWorkflowMedia as jest.Mock).mockResolvedValue({
      data: mediaFixtures,
      meta: {
        total: 3,
        counts: {
          db: 1,
          workspace: 1,
          cloud: 1,
        },
      },
    });
  });

  afterEach(() => {
    (window.confirm as jest.Mock).mockRestore?.();
    (HTMLAnchorElement.prototype.click as jest.Mock).mockRestore?.();
  });

  it('does not load media when closed', () => {
    render(
      <BosMediaModal
        isOpen={false}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(workflowMediaExplorerService.getWorkflowMedia).not.toHaveBeenCalled();
    expect(screen.queryByText('Media du workflow')).not.toBeInTheDocument();
  });

  it('opens cleanly after an initial closed render without changing hook order', async () => {
    const { rerender } = render(
      <BosMediaModal
        isOpen={false}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    rerender(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();
    expect(workflowMediaExplorerService.getWorkflowMedia).toHaveBeenCalledWith('wf-1', expect.objectContaining({
      token: 'token-123',
    }));
  });

  it('renders a red icon-only close button with an accessible close label', async () => {
    const onClose = jest.fn();

    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={onClose}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('loads workflow media and filters items by tab', async () => {
    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(workflowMediaExplorerService.getWorkflowMedia).toHaveBeenCalledWith('wf-1', expect.objectContaining({
        token: 'token-123',
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      }));
    });

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();
    expect(screen.queryByText('database-note.txt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'BDD (1)' }));
    expect(await screen.findByText('database-note.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cloud (1)' }));
    expect(await screen.findByText('cloud-note.txt')).toBeInTheDocument();
    expect(screen.getByText(/manual_detach/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nom/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Type MIME/ })).toBeInTheDocument();
    expect(screen.getByTestId('bos-media-table-scroll')).toBeInTheDocument();
  });

  it('renders runtime provenance metadata for BOS explorer items', async () => {
    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();
    expect(screen.getByText('Artefact runtime')).toBeInTheDocument();
    expect(screen.getByText(/utr-bos-runtime-1/)).toBeInTheDocument();
  });

  it('offers an explicit orphan-only filter in BOS Media', async () => {
    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtre orphelins'), {
      target: { value: 'only' },
    });

    await waitFor(() => {
      expect(workflowMediaExplorerService.getWorkflowMedia).toHaveBeenLastCalledWith('wf-1', expect.objectContaining({
        token: 'token-123',
        includeOrphans: true,
      }));
    });

    expect(await screen.findByText('Vue orphelins uniquement')).toBeInTheDocument();
    expect(screen.getByText('0 orphelin(s) visible(s)')).toBeInTheDocument();
    expect(screen.getByText('Aucun media ne correspond a cet onglet pour le moment.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cloud (1)' }));
    expect(await screen.findByText('cloud-note.txt')).toBeInTheDocument();
    expect(screen.getByText('1 orphelin(s) visible(s)')).toBeInTheDocument();
  });

  it('passes explicit mime and agent filters to the workflow explorer service', async () => {
    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtre type MIME'), {
      target: { value: 'json' },
    });
    fireEvent.change(screen.getByLabelText('Filtre agent'), {
      target: { value: 'Runtime Agent' },
    });

    await waitFor(() => {
      expect(workflowMediaExplorerService.getWorkflowMedia).toHaveBeenLastCalledWith('wf-1', expect.objectContaining({
        token: 'token-123',
        mimeType: 'json',
        agentName: 'Runtime Agent',
      }));
    });
  });

  it('previews a workspace media item with inline text content', async () => {
    (workflowMediaExplorerService.getMediaBlob as jest.Mock).mockResolvedValue(
      new Blob(['preview payload'], { type: 'text/plain' }),
    );

    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apercu' }));

    await waitFor(() => {
      expect(workflowMediaExplorerService.getMediaBlob).toHaveBeenCalledWith('media-workspace', {
        token: 'token-123',
      });
    });

    expect(await screen.findByText('Apercu actif')).toBeInTheDocument();
    expect(screen.getByText('preview payload')).toBeInTheDocument();
    expect(screen.getByTestId('bos-media-preview-scroll')).toBeInTheDocument();
  });

  it('downloads a media item through the authenticated media endpoint', async () => {
    (workflowMediaExplorerService.getMediaBlob as jest.Mock).mockResolvedValue(
      new Blob(['download payload'], { type: 'text/plain' }),
    );
    const appendChildSpy = jest.spyOn(document.body, 'appendChild');

    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Telecharger' }));

    await waitFor(() => {
      expect(workflowMediaExplorerService.getMediaBlob).toHaveBeenCalledWith('media-workspace', {
        token: 'token-123',
        download: true,
      });
    });

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(appendChildSpy).toHaveBeenCalled();
    expect(anchorClickMock).toHaveBeenCalled();
    appendChildSpy.mockRestore();
  });

  it('deletes a media item and updates counts locally', async () => {
    (workflowMediaExplorerService.deleteMedia as jest.Mock).mockResolvedValue({
      success: true,
      message: 'Média supprimé',
      fileDeleted: true,
      warnings: [
        {
          code: 'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED',
          message: 'L historique runtime conserve encore une reference legacy vers cet artefact supprime pour l execution utr-bos-runtime-1.',
          executionId: 'utr-bos-runtime-1',
        },
      ],
    });

    render(
      <BosMediaModal
        isOpen={true}
        workflowId="wf-1"
        workflowName="Workflow Alpha"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText('workspace-note.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => {
      expect(workflowMediaExplorerService.deleteMedia).toHaveBeenCalledWith('media-workspace', {
        token: 'token-123',
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('workspace-note.txt')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Media supprimé du catalogue et de son stockage primaire\./)).toBeInTheDocument();
    expect(screen.getByText(/utr-bos-runtime-1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace (0)' })).toBeInTheDocument();
  });
});