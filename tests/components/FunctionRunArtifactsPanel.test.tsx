import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FunctionRunArtifactsPanel } from '../../components/FunctionRunArtifactsPanel';
import type { FunctionArtifactPreview, FunctionRunRecord } from '../../types/function.types';

const runs: FunctionRunRecord[] = [
    {
        executionId: 'run-1',
        status: 'failed',
        runtime: 'typescript',
        runner: 'docker_sandbox',
        launchContext: 'editor_test',
        createdAt: '2026-03-18T10:00:00.000Z',
        updatedAt: '2026-03-18T10:00:00.000Z',
        timing: { durationMs: 42 },
        error: {
            code: 'DEPENDENCY_MISSING',
            subsystem: 'dependency',
            failureKind: 'dependency_missing',
            message: 'Dépendance manquante pour web_search_py',
            retryable: false
        },
        outputs: {
            artifacts: [{ path: 'output/result.json', kind: 'json' }]
        }
    }
];

const preview: FunctionArtifactPreview = {
    executionId: 'run-1',
    artifact: {
        path: 'output/result.json',
        kind: 'json',
        sizeBytes: 24,
        previewable: true,
        truncated: false,
        contentType: 'application/json',
        jsonContent: { ok: true }
    }
};

describe('FunctionRunArtifactsPanel', () => {
    it('forwards filter, sort, preview and download actions', () => {
        const onRefresh = jest.fn();
        const onOpenArtifact = jest.fn();
        const onDownloadArtifact = jest.fn();
        const onStatusFilterChange = jest.fn();
        const onSortByChange = jest.fn();
        const onSortOrderChange = jest.fn();
        const onPageChange = jest.fn();
        const onCleanupRuns = jest.fn();

        render(
            <FunctionRunArtifactsPanel
                runs={runs}
                pagination={{ page: 1, limit: 20, total: 2, totalPages: 2, sortBy: 'createdAt', sortOrder: 'desc' }}
                statusFilter="all"
                sortBy="createdAt"
                sortOrder="desc"
                isLoading={false}
                error={null}
                artifactPreview={preview}
                isArtifactPreviewLoading={false}
                artifactPreviewError={null}
                onRefresh={onRefresh}
                onOpenArtifact={onOpenArtifact}
                onDownloadArtifact={onDownloadArtifact}
                onStatusFilterChange={onStatusFilterChange}
                onSortByChange={onSortByChange}
                onSortOrderChange={onSortOrderChange}
                onPageChange={onPageChange}
                onCleanupRuns={onCleanupRuns}
            />
        );

        fireEvent.click(screen.getByText('Rafraîchir'));
        fireEvent.change(screen.getByLabelText('Filtrer les runs par statut'), { target: { value: 'failed' } });
        fireEvent.change(screen.getByLabelText('Trier les runs par'), { target: { value: 'durationMs' } });
        fireEvent.change(screen.getByLabelText('Ordre de tri des runs'), { target: { value: 'asc' } });
        fireEvent.click(screen.getByRole('button', { name: 'Prévisualiser output/result.json' }));
        fireEvent.click(screen.getByRole('button', { name: 'Télécharger output/result.json' }));
        fireEvent.click(screen.getByText('Page suivante'));
        fireEvent.click(screen.getByText('Nettoyer >14j'));

        expect(onRefresh).toHaveBeenCalled();
        expect(onStatusFilterChange).toHaveBeenCalledWith('failed');
        expect(onSortByChange).toHaveBeenCalledWith('durationMs');
        expect(onSortOrderChange).toHaveBeenCalledWith('asc');
        expect(onOpenArtifact).toHaveBeenCalledWith('run-1', 'output/result.json');
        expect(onDownloadArtifact).toHaveBeenCalledWith('run-1', 'output/result.json');
        expect(onPageChange).toHaveBeenCalledWith(2);
        expect(onCleanupRuns).toHaveBeenCalled();
        expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
        expect(screen.getByText('DEPENDENCY_MISSING')).toBeInTheDocument();
        expect(screen.getByText('dependency')).toBeInTheDocument();
        expect(screen.getByText(/failure dependency_missing/)).toBeInTheDocument();
        expect(screen.getAllByText('Echec d execution')).toHaveLength(2);
        expect(screen.getByText(/Diagnostic QA: Dependance runtime manquante/)).toBeInTheDocument();
        expect(screen.getByText(/Action recommandee: Verifier l image runtime ou le provisionnement plateforme des dependances requises./)).toBeInTheDocument();
    });
});