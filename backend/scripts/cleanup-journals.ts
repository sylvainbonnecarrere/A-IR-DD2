/**
 * @fileoverview Script de nettoyage des journaux
 * 
 * ⭐ ÉTAPE 2: PHASE 3 FIX - Supprime TOUS les documents de la collection agent_journals
 * 
 * JUSTIFICATION:
 * - Redémarrage propre après correction du bug de duplication
 * - Validation que la solution est robuste depuis zéro
 * - Prévention de polluter les anciens journaux dupliqués
 * 
 * USAGE:
 *   cd backend
 *   npm run ts-node -- scripts/cleanup-journals.ts
 * 
 * SÉCURITÉ:
 * - Demande confirmation avant exécution (safeguard)
 * - Affiche le nombre de documents supprimés
 * - Marque le timestamp d'exécution
 */

import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';
import readline from 'readline';

// ESM: Obtenir __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURATION
// ============================================

// Variables d'environnement avec défauts
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/irdd2_db';
const COLLECTION_NAME = 'agent_journals';

// ============================================
// UTILITAIRES
// ============================================

/**
 * Affiche une ligne avec timestamp
 */
function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    console.log(`${prefix} ${message}`);
}

/**
 * Demande confirmation à l'utilisateur (async)
 */
function askConfirmation(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

// ============================================
// MAIN SCRIPT
// ============================================

async function cleanupJournals(): Promise<void> {
    try {
        log('🔍 Nettoyage de collection agent_journals...', 'INFO');
        log(`📍 MongoDB URI: ${MONGO_URI}`, 'INFO');

        // Étape 1: Connexion à MongoDB
        log('⏳ Connexion à MongoDB...', 'INFO');
        await mongoose.connect(MONGO_URI);
        log('✅ Connecté à MongoDB', 'SUCCESS');

        // Étape 2: Obtenir la collection
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Impossible d\'accéder à la base de données');
        }

        const collection = db.collection(COLLECTION_NAME);

        // Étape 3: Compter les documents avant suppression
        const countBefore = await collection.countDocuments();
        log(`📊 Documents avant nettoyage: ${countBefore}`, 'INFO');

        if (countBefore === 0) {
            log('✅ Collection déjà vide - aucune suppression nécessaire', 'SUCCESS');
            await mongoose.disconnect();
            return;
        }

        // Étape 4: Demander confirmation
        log('⚠️  ATTENTION: Vous êtes sur le point de SUPPRIMER tous les journaux (${countBefore} documents)', 'WARN');
        const confirmed = await askConfirmation('Êtes-vous sûr? Tapez "yes" pour confirmer: ');

        if (!confirmed) {
            log('❌ Opération annulée par l\'utilisateur', 'WARN');
            await mongoose.disconnect();
            return;
        }

        // Étape 5: Supprimer TOUS les documents
        log('🔥 Suppression de tous les documents...', 'INFO');
        const result = await collection.deleteMany({});

        const deletedCount = result.deletedCount || 0;
        log(`🗑️  ${deletedCount} document(s) supprimé(s)`, 'SUCCESS');

        // Étape 6: Vérifier le résultat
        const countAfter = await collection.countDocuments();
        log(`📊 Documents après nettoyage: ${countAfter}`, 'INFO');

        if (countAfter === 0) {
            log('✅ Nettoyage réussi - collection vide', 'SUCCESS');
        } else {
            log(`⚠️  Attention: ${countAfter} document(s) restant(s)`, 'WARN');
        }

        // Étape 7: Afficher les index existants
        log('📋 Index existants sur la collection:', 'INFO');
        const indexes = await collection.listIndexes().toArray();
        indexes.forEach((idx, i) => {
            log(`  ${i + 1}. ${idx.name}`, 'INFO');
        });

        log('✅ Script nettoyage terminé avec succès', 'SUCCESS');

    } catch (error) {
        log(`❌ Erreur: ${error instanceof Error ? error.message : String(error)}`, 'ERROR');
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        // Déconnection
        try {
            await mongoose.disconnect();
            log('🔌 Déconnecté de MongoDB', 'INFO');
        } catch (err) {
            log(`Erreur lors de la déconnexion: ${err}`, 'ERROR');
        }
    }
}

// ============================================
// EXÉCUTION
// ============================================

cleanupJournals();
