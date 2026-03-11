/**
 * Migration 004 — Tools V2 : Function Registry
 *
 * Direction UP :
 * 1. Crée la collection user_functions avec les index
 * 2. Seed des 11 fonctions natives (origin: 'native', userId: null)
 * 3. Migre agent_prototypes.tools → legacyTools (#zero data loss)
 * 4. Migre agent_instances.tools → legacyTools (#zero data loss)
 *
 * Direction DOWN (rollback) :
 * 1. Restaure agent_prototypes.tools depuis legacyTools
 * 2. Restaure agent_instances.tools depuis legacyTools
 * 3. Supprime la collection user_functions
 *
 * Usage : npx ts-node src/migrations/004_tools_v2_function_registry.ts [up|down]
 */

import mongoose from 'mongoose';
import { nativeFunctionsSeed } from '../seeds/nativeFunctions.seed';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aitest';

async function up() {
    await mongoose.connect(MONGODB_URI);
    console.log('[Migration 004] Connecté à MongoDB');

    const db = mongoose.connection.db!;

    // 1. Créer la collection user_functions si elle n'existe pas
    const collections = await db.listCollections({ name: 'user_functions' }).toArray();
    if (collections.length === 0) {
        await db.createCollection('user_functions');
        console.log('[Migration 004] Collection user_functions créée');
    }

    // 2. Seed des 11 fonctions natives (idempotent : upsert par name + userId:null)
    const userFunctionsCol = db.collection('user_functions');
    let seedCount = 0;
    for (const fn of nativeFunctionsSeed) {
        await userFunctionsCol.updateOne(
            { name: fn.name, userId: null },
            { $setOnInsert: { ...fn, createdAt: new Date(), updatedAt: new Date() } },
            { upsert: true }
        );
        seedCount++;
    }
    console.log(`[Migration 004] ${seedCount} fonctions natives seedées (upsert)`);

    // 3. Migrer agent_prototypes.tools → legacyTools (zéro perte de données)
    const prototypesCol = db.collection('agent_prototypes');
    const protosResult = await prototypesCol.updateMany(
        {
            tools: { $exists: true, $type: 'array', $ne: [] },
            legacyTools: { $exists: false }
        },
        [{ $set: { legacyTools: '$tools', tools: [] } }]
    );
    console.log(`[Migration 004] ${protosResult.modifiedCount} prototypes migrés (tools → legacyTools)`);

    // 4. Migrer agent_instances.tools → legacyTools
    const instancesCol = db.collection('agent_instances');
    const instancesResult = await instancesCol.updateMany(
        {
            tools: { $exists: true, $type: 'array', $ne: [] },
            legacyTools: { $exists: false }
        },
        [{ $set: { legacyTools: '$tools', tools: [] } }]
    );
    console.log(`[Migration 004] ${instancesResult.modifiedCount} instances migrées (tools → legacyTools)`);

    // 5. Créer les index (idempotent)
    await userFunctionsCol.createIndex(
        { userId: 1, workflowId: 1, isEnabled: 1 },
        { background: true, name: 'idx_user_workflow_enabled' }
    );
    await userFunctionsCol.createIndex(
        { origin: 1, isEnabled: 1 },
        { background: true, name: 'idx_origin_enabled' }
    );
    await userFunctionsCol.createIndex(
        { name: 1, userId: 1 },
        { unique: true, background: true, name: 'idx_name_user_unique' }
    );
    console.log('[Migration 004] Index user_functions créés');

    await mongoose.connection.close();
    console.log('[Migration 004] UP terminé avec succès');
}

async function down() {
    await mongoose.connect(MONGODB_URI);
    console.log('[Migration 004] Rollback — Connecté à MongoDB');

    const db = mongoose.connection.db!;

    // 1. Restaurer agent_prototypes.tools depuis legacyTools
    const prototypesCol = db.collection('agent_prototypes');
    const protosResult = await prototypesCol.updateMany(
        { legacyTools: { $exists: true, $ne: [] } },
        [{ $set: { tools: '$legacyTools' }, $unset: ['legacyTools'] }]
    );
    console.log(`[Migration 004 DOWN] ${protosResult.modifiedCount} prototypes restaurés`);

    // 2. Restaurer agent_instances.tools depuis legacyTools
    const instancesCol = db.collection('agent_instances');
    const instancesResult = await instancesCol.updateMany(
        { legacyTools: { $exists: true, $ne: [] } },
        [{ $set: { tools: '$legacyTools' }, $unset: ['legacyTools'] }]
    );
    console.log(`[Migration 004 DOWN] ${instancesResult.modifiedCount} instances restaurées`);

    // 3. Supprimer la collection user_functions
    await db.dropCollection('user_functions').catch(() => {
        console.log('[Migration 004 DOWN] Collection user_functions inexistante, skip');
    });
    console.log('[Migration 004 DOWN] Collection user_functions supprimée');

    await mongoose.connection.close();
    console.log('[Migration 004] DOWN (rollback) terminé');
}

// Point d'entrée CLI
const direction = process.argv[2] || 'up';
const runner = direction === 'down' ? down : up;
runner().catch(err => {
    console.error('[Migration 004] ERREUR:', err);
    process.exit(1);
});
