import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ToolCallBlock from '../../components/workflow/ToolCallBlock';
import apiClient from '../../utils/apiClient';

jest.mock('../../utils/apiClient', () => ({
    __esModule: true,
    default: {
        get: jest.fn()
    }
}));

describe('ToolCallBlock', () => {
    const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
    const createObjectURL = jest.fn(() => 'blob:mock-download');
    let clickSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURL, writable: true });
        Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), writable: true });
        clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
        clickSpy.mockRestore();
    });

    it('loads artifact preview on demand', async () => {
        mockedApiClient.get.mockResolvedValueOnce({
            data: {
                executionId: 'exec-1',
                artifact: {
                    path: 'output/report.json',
                    kind: 'json',
                    sizeBytes: 17,
                    previewable: true,
                    truncated: false,
                    contentType: 'application/json',
                    jsonContent: { ok: true }
                }
            }
        } as any);

        render(
            <ToolCallBlock
                defaultExpanded
                toolCall={{
                    id: 'tool-call-1',
                    functionId: 'fn-1',
                    functionName: 'demo_tool',
                    arguments: { foo: 'bar' },
                    result: { ok: true },
                    status: 'success',
                    executionId: 'exec-1',
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    timestamp: new Date('2026-03-18T10:00:00.000Z')
                }}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Prévisualiser output/report.json' }));

        await waitFor(() => {
            expect(mockedApiClient.get).toHaveBeenCalledWith('/api/runs/tool/fn-1/exec-1/artifacts/content', {
                params: { path: 'output/report.json' }
            });
        });

        expect(screen.getAllByText(/"ok": true/).length).toBeGreaterThan(0);
    });

    it('downloads an artifact on demand', async () => {
        mockedApiClient.get.mockResolvedValueOnce({ data: new Blob(['artifact']) } as any);

        const appendSpy = jest.spyOn(document.body, 'appendChild');
        const removeSpy = jest.spyOn(HTMLElement.prototype, 'remove');

        render(
            <ToolCallBlock
                defaultExpanded
                toolCall={{
                    id: 'tool-call-2',
                    functionId: 'fn-1',
                    functionName: 'demo_tool',
                    arguments: {},
                    result: { ok: true },
                    status: 'success',
                    executionId: 'exec-1',
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    timestamp: new Date('2026-03-18T10:00:00.000Z')
                }}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Télécharger output/report.json' }));

        await waitFor(() => {
            expect(mockedApiClient.get).toHaveBeenCalledWith('/api/runs/tool/fn-1/exec-1/artifacts/download', {
                params: { path: 'output/report.json' },
                responseType: 'blob'
            });
        });

        expect(createObjectURL).toHaveBeenCalled();
        expect(appendSpy).toHaveBeenCalled();
        expect(removeSpy).toHaveBeenCalled();
    });
});