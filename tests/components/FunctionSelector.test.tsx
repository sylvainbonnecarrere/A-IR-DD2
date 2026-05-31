import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FunctionSelector } from '../../components/FunctionSelector';
import type { ToolSelection } from '../../types';
import type { UserFunction } from '../../types/function.types';

const mockLoadFunctions = jest.fn();

let functionStoreState: {
    functions: UserFunction[];
    isLoading: boolean;
    loadFunctions: jest.Mock;
    runtimeCompatibility: null;
};

jest.mock('../../hooks/useAuth', () => ({
    useAuth: jest.fn(() => ({
        isAuthenticated: true,
    })),
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: jest.fn(() => functionStoreState),
}));

const createFunction = (overrides: Partial<UserFunction> = {}): UserFunction => ({
    _id: 'legacy-weather',
    toolId: 'tool.weather',
    name: 'Weather Tool',
    description: 'Returns weather data',
    language: 'python',
    origin: 'custom',
    userId: 'user-1',
    workflowId: 'wf-1',
    inputSchema: {},
    outputSchema: {},
    codePath: 'tools/weather.py',
    resolvedCodePath: 'tools/weather.py',
    codePathRoot: 'workspace_source',
    codeInline: 'def run(context, args):\n    return {"ok": True}',
    dependencies: [],
    isEnabled: true,
    isReadonly: false,
    version: 3,
    versionTag: 'v3',
    tags: ['weather'],
    createdAt: '2026-03-23T10:00:00.000Z',
    updatedAt: '2026-03-23T10:00:00.000Z',
    ...overrides,
});

describe('FunctionSelector', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        functionStoreState = {
            functions: [createFunction()],
            isLoading: false,
            loadFunctions: mockLoadFunctions,
            runtimeCompatibility: null,
        };
    });

    it('removes a canonical selection even when the current selection still uses the legacy id', async () => {
        const onChange = jest.fn();

        render(
            <FunctionSelector
                selectedIds={['legacy-weather']}
                onChange={onChange}
            />
        );

        await waitFor(() => {
            expect(mockLoadFunctions).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByRole('button', { name: /weather tool/i }));

        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('adds the canonical tool id when selecting an unselected function', () => {
        const onChange = jest.fn();

        render(
            <FunctionSelector
                selectedIds={[]}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /weather tool/i }));

        expect(onChange).toHaveBeenCalledWith(['tool.weather']);
    });

    it('ignores disabled functions in edit mode', () => {
        const onChange = jest.fn();
        functionStoreState.functions = [createFunction({ isEnabled: false })];

        render(
            <FunctionSelector
                selectedIds={[]}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /weather tool/i }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it('emits canonical ToolSelection objects when used with the new contract', async () => {
        const onChangeToolSelections = jest.fn();
        const selectedToolSelections: ToolSelection[] = [];

        render(
            <FunctionSelector
                selectedToolSelections={selectedToolSelections}
                onChangeToolSelections={onChangeToolSelections}
            />
        );

        await waitFor(() => {
            expect(mockLoadFunctions).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByRole('button', { name: /weather tool/i }));

        expect(onChangeToolSelections).toHaveBeenCalledWith([
            expect.objectContaining({
                toolId: 'tool.weather',
                versionRef: expect.objectContaining({
                    versionTag: 'v3',
                    versionNumber: 3,
                }),
            }),
        ]);
    });
});