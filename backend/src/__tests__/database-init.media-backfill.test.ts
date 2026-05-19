jest.mock('../migrations/006_media_reference_catalog_backfill', () => ({
    backfillMediaReferenceCatalogFields: jest.fn(),
}));

import { backfillMediaReferenceCatalogFields } from '../migrations/006_media_reference_catalog_backfill';
import { runMediaReferenceCatalogBackfill } from '../services/databaseInit';

describe('databaseInit media catalog backfill bootstrap', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('runs the additive media catalog backfill when media_references exist', async () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
        const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        (backfillMediaReferenceCatalogFields as jest.Mock).mockResolvedValue({
            collectionFound: true,
            scanned: 4,
            updated: 2,
            alreadyCompatible: 2,
            blocked: 0,
            indexesEnsured: 7,
        });

        const db = { name: 'fake-db' };

        await runMediaReferenceCatalogBackfill(db);

        expect(backfillMediaReferenceCatalogFields).toHaveBeenCalledWith(db);
        expect(infoSpy).toHaveBeenCalledWith('🧩 Media catalog backfill: scanned=4 updated=2 compatible=2 blocked=0');
        expect(debugSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        infoSpy.mockRestore();
        debugSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('stays non-blocking when the media catalog collection is absent', async () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
        const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        (backfillMediaReferenceCatalogFields as jest.Mock).mockResolvedValue({
            collectionFound: false,
            scanned: 0,
            updated: 0,
            alreadyCompatible: 0,
            blocked: 0,
            indexesEnsured: 0,
        });

        await runMediaReferenceCatalogBackfill({});

        expect(debugSpy).toHaveBeenCalledWith('  • media_references absent, backfill catalogue media ignoré');
        expect(infoSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        infoSpy.mockRestore();
        debugSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('swallows backfill failures and logs a warning instead of blocking startup', async () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
        const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        (backfillMediaReferenceCatalogFields as jest.Mock).mockRejectedValue(new Error('boom'));

        await expect(runMediaReferenceCatalogBackfill({})).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith('⚠️  media catalog backfill warning:', 'boom');
        expect(infoSpy).not.toHaveBeenCalled();
        expect(debugSpy).not.toHaveBeenCalled();

        infoSpy.mockRestore();
        debugSpy.mockRestore();
        warnSpy.mockRestore();
    });
});