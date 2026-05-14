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
    expect(screen.getByText(/Orphelin/)).toBeInTheDocument();
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
    expect(screen.getByText('Media supprimé du catalogue et de son stockage primaire.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace (0)' })).toBeInTheDocument();
  });
});