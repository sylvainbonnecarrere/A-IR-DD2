#!/usr/bin/env node

/**
 * Simple cleanup script pour supprimer tous les journaux
 * Utilise CommonJS pour compatibilité ts-node
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/a-ir-dd2-dev';

async function cleanup() {
    try {
        console.log('[INFO] Connexion à MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('[SUCCESS] Connecté à MongoDB');

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Impossible d\'accéder à la base de données');
        }

        const collection = db.collection('agent_journals');

        // Compter avant
        const countBefore = await collection.countDocuments();
        console.log(`[INFO] Documents avant cleanup: ${countBefore}`);

        if (countBefore === 0) {
            console.log('[SUCCESS] Collection déjà vide');
            await mongoose.disconnect();
            return;
        }

        // Supprimer
        console.log('[INFO] Suppression de tous les documents...');
        const result = await collection.deleteMany({});
        console.log(`[SUCCESS] ${result.deletedCount} document(s) supprimé(s)`);

        // Compter après
        const countAfter = await collection.countDocuments();
        console.log(`[INFO] Documents après cleanup: ${countAfter}`);

        if (countAfter === 0) {
            console.log('[SUCCESS] Nettoyage réussi - collection vide ✓');
        }

        // Lister les index
        console.log('[INFO] Indexes:');
        const indexes = await collection.listIndexes().toArray();
        indexes.forEach((idx, i) => {
            console.log(`  ${i + 1}. ${idx.name}`);
        });

    } catch (error) {
        console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    } finally {
        try {
            await mongoose.disconnect();
            console.log('[INFO] Déconnecté de MongoDB');
        } catch (err) {
            console.error('[ERROR] Erreur lors de la déconnexion:', err);
        }
    }
}

cleanup();
