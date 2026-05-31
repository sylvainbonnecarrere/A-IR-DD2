import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavePrototypeButton from '../../components/SavePrototypeButton';
import type { PendingNodeAttachment } from '../../types';

const mockSaveWorkflow = jest.fn();

let authState: Record<string, unknown>;
let designStoreState: Record<string, unknown>;
let runtimeStoreState: Record<string, unknown>;

jest.mock('../../contexts/AuthContext', () => ({
    useAuth: () => authState,
}));

jest.mock('../../hooks/useSaveMode', () => ({
    useSaveMode: () => ({ isManualSave: true }),
}));

jest.mock('../../stores/useDesignStore', () => ({
    useDesignStore: jest.fn(() => designStoreState),
}));

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: jest.fn(() => runtimeStoreState),
}));

jest.mock('../../services/persistenceService', () => ({
    PersistenceService: {
        saveWorkflow: (...args: unknown[]) => mockSaveWorkflow(...args),
    },
}));

jest.mock('../../config/api.config', () => ({
    getBackendUrl: () => 'http://localhost:3001',
}));

describe('SavePrototypeButton draft import persistence', () => {
    beforeEach(() => {
        authState = {
            isAuthenticated: true,
            accessToken: 'token-123',
        };

        designStoreState = {
            nodes: [
                {
                    id: 'node-1',
                    type: 'agent',
                    position: { x: 0, y: 0 },
                    data: {
                        workflowId: '507f1f77bcf86cd799439011',
                        agentInstance: {
                            id: '507f1f77bcf86cd799439012',
                            workflowId: '507f1f77bcf86cd799439011',
                        },
                    },
                },
            ],
            edges: [],
        };

        const pendingAttachment: PendingNodeAttachment = {
            id: 'draft-file-1',
            fileName: 'notes.txt',
            mimeType: 'text/plain',
            base64Content: Buffer.from('Bonjour draft', 'utf8').toString('base64'),
            textContent: 'Bonjour draft',
            origin: 'llm_file_upload',
            createdAt: new Date('2026-05-18T15:00:00.000Z'),
            draftPersisted: false,
        };

        runtimeStoreState = {
            nodeMessages: {},
            nodePendingAttachments: {
                'node-1': pendingAttachment,
            },
            getNewMessages: jest.fn(() => []),
            setLastSavedAt: jest.fn(),
            updateNodePendingAttachment: jest.fn(),
        };

        mockSaveWorkflow.mockReset().mockResolvedValue({ success: true });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, journalId: 'journal-1' }),
        } as Response);
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    it('persists a pending imported file draft through the dedicated backend route on manual save', async () => {
        render(
            <SavePrototypeButton
                workflowId="507f1f77bcf86cd799439011"
                workflowName="Workflow Draft"
                canvasState={{ zoom: 1, panX: 0, panY: 0 }}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Save prototype workflow' }));

        await waitFor(() => {
            expect(mockSaveWorkflow).toHaveBeenCalled();
            expect(global.fetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/workflows/507f1f77bcf86cd799439011/instances/507f1f77bcf86cd799439012/imported-media',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        Authorization: 'Bearer token-123',
                    }),
                })
            );
            expect(runtimeStoreState.updateNodePendingAttachment).toHaveBeenCalledWith('node-1', expect.objectContaining({
                draftPersisted: true,
                persistedAt: expect.any(Date),
            }));
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect((global.fetch as jest.Mock).mock.calls[0][1]?.body).toBe(JSON.stringify({
            attachmentId: 'draft-file-1',
            fileName: 'notes.txt',
            mimeType: 'text/plain',
            contentBase64: Buffer.from('Bonjour draft', 'utf8').toString('base64'),
            origin: 'llm_file_upload',
        }));
    });
});
