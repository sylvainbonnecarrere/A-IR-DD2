import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { initializeDatabase } from '../services/databaseInit';
import { migrateLegacyUserFunctionsToUserToolsAndDropCollection } from '../migrations/005_user_functions_eol';

interface SetupOptions {
    cleanupLegacy: boolean;
}

function parseOptions(argv: string[]): SetupOptions {
    return {
        cleanupLegacy: !argv.includes('--seed-only'),
    };
}

async function run(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));

    console.log('[Setup Tools V2] Initialisation du catalogue canonique user_tools...');
    await connectDatabase();

    try {
        await initializeDatabase();

        if (!options.cleanupLegacy) {
            console.log('[Setup Tools V2] Seed-only termine.');
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('MongoDB database handle unavailable after initialization');
        }

        const summary = await migrateLegacyUserFunctionsToUserToolsAndDropCollection(db);
        console.log(
            `[Setup Tools V2] Nettoyage legacy: found=${summary.collectionFound} scanned=${summary.scanned} created=${summary.created} skippedExistingById=${summary.skippedExistingById} blocked=${summary.blockedByLogicalConflict} dropped=${summary.dropped}`
        );

        if (summary.blockedByLogicalConflict > 0) {
            throw new Error(
                `${summary.blockedByLogicalConflict} conflit(s) logique(s) legacy user_functions detecte(s); abandon du drop`
            );
        }
    } finally {
        await disconnectDatabase();
    }

    console.log('[Setup Tools V2] Terminé.');
}

run().catch((err) => {
    console.error('[Setup Tools V2] ERREUR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
});