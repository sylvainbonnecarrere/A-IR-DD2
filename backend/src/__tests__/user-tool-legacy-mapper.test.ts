import mongoose from 'mongoose';
import {
    deriveExecutionMetadataFromLegacyFunction,
    mapLegacyFunctionToUserToolFields
} from '../utils/userToolLegacyMapper';

describe('userToolLegacyMapper', () => {
    it('preserves provisioned runtime state when the mirrored version identity is unchanged', () => {
        const legacyFunction = {
            _id: new mongoose.Types.ObjectId(),
            name: 'web_search_py',
            description: 'Recherche web native',
            language: 'python' as const,
            origin: 'native' as const,
            userId: null,
            workflowId: null,
            inputSchema: {},
            outputSchema: {},
            codePath: 'backend/python/native/web_search_py.py',
            dependencies: { python: [], npm: [] },
            isEnabled: true,
            isReadonly: true,
            version: 'v-ready',
            createdAt: new Date('2026-03-31T12:00:00.000Z'),
            updatedAt: new Date('2026-03-31T12:00:00.000Z')
        };
        const baseline = mapLegacyFunctionToUserToolFields(legacyFunction) as any;

        const mapped = mapLegacyFunctionToUserToolFields(
            legacyFunction,
            {
                currentVersion: {
                    versionTag: 'v-ready',
                    contentHash: baseline.currentVersion.contentHash,
                    buildStatus: 'built',
                    validationStatus: 'valid'
                },
                versions: [{
                    versionTag: 'v-ready',
                    contentHash: baseline.currentVersion.contentHash,
                    buildStatus: 'built',
                    validationStatus: 'valid'
                }]
            }
        ) as any;

        expect(mapped.currentVersion).toEqual(expect.objectContaining({
            versionTag: 'v-ready',
            createdAt: legacyFunction.updatedAt,
            buildStatus: 'built',
            validationStatus: 'valid'
        }));
        expect(mapped.versions).toEqual([
            expect.objectContaining({
                versionTag: 'v-ready',
                createdAt: legacyFunction.updatedAt,
                buildStatus: 'built',
                validationStatus: 'valid'
            })
        ]);
    });

    it('resets runtime state when the mirrored source identity changes', () => {
        const baselineLegacyFunction = {
            _id: new mongoose.Types.ObjectId(),
            name: 'web_search_py',
            description: 'Recherche web native',
            language: 'python' as const,
            origin: 'native' as const,
            userId: null,
            workflowId: null,
            inputSchema: {},
            outputSchema: {},
            codePath: 'backend/python/native/web_search_py.py',
            dependencies: { python: [], npm: [] },
            isEnabled: true,
            isReadonly: true,
            version: 'v-ready',
            createdAt: new Date('2026-03-31T12:00:00.000Z'),
            updatedAt: new Date('2026-03-31T12:00:00.000Z')
        };
        const changedLegacyFunction = {
            ...baselineLegacyFunction,
            dependencies: { python: ['requests==2.32.3'], npm: [] }
        };
        const baseline = mapLegacyFunctionToUserToolFields(baselineLegacyFunction) as any;

        const mapped = mapLegacyFunctionToUserToolFields(
            changedLegacyFunction,
            {
                currentVersion: {
                    versionTag: 'v-ready',
                    contentHash: baseline.currentVersion.contentHash,
                    buildStatus: 'built',
                    validationStatus: 'valid'
                }
            }
        ) as any;

        expect(mapped.currentVersion).toEqual(expect.objectContaining({
            versionTag: 'v-ready',
            buildStatus: 'not_built',
            validationStatus: 'unknown'
        }));
    });

    it('defaults native web_search_py mirrors and execution metadata to restricted network access', () => {
        const legacyFunction = {
            _id: new mongoose.Types.ObjectId(),
            name: 'web_search_py',
            description: 'Recherche web native',
            language: 'python' as const,
            origin: 'native' as const,
            userId: null,
            workflowId: null,
            inputSchema: {},
            outputSchema: {},
            codePath: 'backend/python/native/web_search_py.py',
            dependencies: { python: [], npm: [] },
            isEnabled: true,
            isReadonly: true,
            version: 'v-ready'
        };

        const mapped = mapLegacyFunctionToUserToolFields(legacyFunction) as any;
        const executionMetadata = deriveExecutionMetadataFromLegacyFunction(legacyFunction);

        expect(mapped.policy).toEqual({
            networkMode: 'restricted',
            writablePaths: [],
            secretAliases: [],
            timeoutSeconds: 180,
            maxMemoryMb: 256
        });
        expect(executionMetadata.policySnapshot).toEqual({
            networkMode: 'restricted',
            writablePaths: [],
            secretAliases: [],
            timeoutSeconds: 180,
            maxMemoryMb: 256
        });
    });
});