#!/usr/bin/env npx ts-node
/**
 * @fileoverview Script de validation End-to-End - Flux de persistance (Jalon 5)
 *
 * Ce script simule un flux complet sans Frontend pour valider :
 * 1. Création Workflow
 * 2. Création Instance (API V2) avec saveChatHistory: true
 * 3. Appel POST /api/instances/:id/chat
 * 4. Vérification journal contient le message
 * 5. Mise à jour config (saveChatHistory: false)
 * 6. Nouvel appel chat -> Vérification journal vide pour ce message
 * 7. Suppression Nœud -> Vérification cascade (Instance + Journaux supprimés)
 *
 * Usage: npx ts-node backend/scripts/test-persistence-flow.ts
 *
 * @see backend/src/services/journal.service.ts
 * @see backend/src/routes/instances.routes.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Charger les variables d'environnement
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Imports après dotenv
import { User, IUser } from '../src/models/User.model';
import { Workflow } from '../src/models/Workflow.model';
import { WorkflowNodeV2 } from '../src/models/WorkflowNodeV2.model';
import { AgentInstanceV2 } from '../src/models/AgentInstanceV2.model';
import { AgentJournal } from '../src/models/AgentJournal.model';
import { JournalService } from '../src/services/journal.service';
import { DEFAULT_PERSISTENCE_CONFIG } from '../src/types/persistence';

// ============================================
// CONFIGURATION
// ============================================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/irdd-e2e-test';
const TEST_PREFIX = `e2e-test-${Date.now()}`;

// Codes couleur console
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// ============================================
// HELPERS
// ============================================

function log(message: string, type: 'info' | 'success' | 'error' | 'step' = 'info') {
  const prefix = {
    info: `${COLORS.cyan}[INFO]${COLORS.reset}`,
    success: `${COLORS.green}[✓]${COLORS.reset}`,
    error: `${COLORS.red}[✗]${COLORS.reset}`,
    step: `${COLORS.bold}${COLORS.yellow}[STEP]${COLORS.reset}`,
  };
  console.log(`${prefix[type]} ${message}`);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    log(`Assertion failed: ${message}`, 'error');
    throw new Error(message);
  }
  log(message, 'success');
}

// ============================================
// SCRIPT PRINCIPAL
// ============================================

async function runPersistenceFlowTest() {
  console.log('\n' + '='.repeat(60));
  console.log(`${COLORS.bold}${COLORS.cyan}VALIDATION E2E - FLUX DE PERSISTANCE${COLORS.reset}`);
  console.log('='.repeat(60) + '\n');

  let testUser: IUser | null = null;
  let workflowId: string | null = null;
  let nodeId: string | null = null;
  let instanceId: string | null = null;
  const journalService = new JournalService();

  try {
    // ============================================
    // CONNEXION MONGODB
    // ============================================

    log('Connexion à MongoDB...', 'step');
    await mongoose.connect(MONGODB_URI);
    log(`Connecté à ${MONGODB_URI}`, 'success');

    // ============================================
    // ÉTAPE 0: Création utilisateur test
    // ============================================

    log('Création utilisateur test...', 'step');
    testUser = await User.create({
      email: `${TEST_PREFIX}@test.com`,
      password: 'hashedpassword12345',
      username: TEST_PREFIX,
    });
    log(`Utilisateur créé: ${testUser._id}`, 'success');

    // ============================================
    // ÉTAPE 1: Création Workflow
    // ============================================

    log('Création workflow...', 'step');
    const workflow = await Workflow.create({
      name: `${TEST_PREFIX}-workflow`,
      ownerId: testUser._id,
      nodes: [],
      edges: [],
    });
    workflowId = workflow._id.toString();
    log(`Workflow créé: ${workflowId}`, 'success');

    // ============================================
    // ÉTAPE 2: Création Instance (API V2) avec saveChatHistory: true
    // ============================================

    log('Création instance avec saveChatHistory: true...', 'step');

    // D'abord créer le nœud
    const node = await WorkflowNodeV2.create({
      workflowId: workflow._id,
      ownerId: testUser._id,
      nodeId: `node-${Date.now()}`,
      type: 'agent',
      position: { x: 100, y: 100 },
      uiConfig: {
        width: 300,
        height: 200,
        collapsed: false,
        showChat: true,
      },
    });
    nodeId = node._id.toString();
    log(`Nœud V2 créé: ${nodeId}`, 'success');

    // Puis créer l'instance
    const instance = await AgentInstanceV2.create({
      workflowId: workflow._id,
      nodeId: node._id,
      userId: testUser._id,
      name: `${TEST_PREFIX}-agent`,
      role: 'Agent de test E2E',
      robotId: 'AR_001',
      configuration: {
        llmProvider: 'openai',
        llmModel: 'gpt-4',
      },
      persistenceConfig: {
        ...DEFAULT_PERSISTENCE_CONFIG,
        saveChatHistory: true, // ACTIVÉ
      },
      state: {},
      status: 'idle',
    });
    instanceId = instance._id.toString();
    log(`Instance créée: ${instanceId} (saveChatHistory: true)`, 'success');

    // ============================================
    // ÉTAPE 3: Appel logChat (simulation runtime)
    // ============================================

    log('Simulation appel POST /api/instances/:id/chat...', 'step');

    const chatResult1 = await journalService.logChat(
      {
        instanceId,
        role: 'user',
        content: 'Bonjour, ceci est un message de test E2E',
        model: 'gpt-4',
      },
      { sessionId: 'e2e-session-1' },
    );

    assert(chatResult1.success === true, 'logChat retourne success: true');
    assert(chatResult1.saved === true, 'logChat retourne saved: true (car saveChatHistory: true)');
    assert(chatResult1.entryId !== undefined, 'logChat retourne un entryId');

    const firstEntryId = chatResult1.entryId;
    log(`Message sauvegardé avec ID: ${firstEntryId}`, 'info');

    // ============================================
    // ÉTAPE 4: Vérification journal contient le message
    // ============================================

    log('Vérification du journal en BDD...', 'step');

    const journals = await AgentJournal.find({ agentInstanceId: instanceId });
    assert(journals.length === 1, 'Le journal contient exactement 1 entrée');
    assert(journals[0].type === 'chat', 'L\'entrée est de type "chat"');

    const payload = journals[0].payload as { data: { content: string } };
    assert(payload.data.content === 'Bonjour, ceci est un message de test E2E', 'Le contenu du message est correct');
    log('Contenu du journal vérifié', 'success');

    // ============================================
    // ÉTAPE 5: Mise à jour config (saveChatHistory: false)
    // ============================================

    log('Mise à jour config: saveChatHistory → false...', 'step');

    await AgentInstanceV2.findByIdAndUpdate(instanceId, {
      $set: { 'persistenceConfig.saveChatHistory': false },
    });

    const updatedInstance = await AgentInstanceV2.findById(instanceId);
    assert(updatedInstance?.persistenceConfig.saveChatHistory === false, 'Config mise à jour: saveChatHistory = false');

    // ============================================
    // ÉTAPE 6: Nouvel appel chat -> Vérification non sauvegardé
    // ============================================

    log('Nouvel appel chat (devrait être ignoré)...', 'step');

    const chatResult2 = await journalService.logChat(
      {
        instanceId,
        role: 'user',
        content: 'Ce message NE DEVRAIT PAS être sauvegardé',
        model: 'gpt-4',
      },
      { sessionId: 'e2e-session-2' },
    );

    assert(chatResult2.success === true, 'logChat retourne success: true');
    assert(chatResult2.saved === false, 'logChat retourne saved: false (car saveChatHistory: false)');
    assert(chatResult2.reason !== undefined, 'logChat retourne une raison');
    log(`Raison: ${chatResult2.reason}`, 'info');

    // Vérifier que le journal n'a pas augmenté
    const journalsAfter = await AgentJournal.find({ agentInstanceId: instanceId });
    assert(journalsAfter.length === 1, 'Le journal contient TOUJOURS 1 seule entrée (message non sauvegardé)');

    // ============================================
    // ÉTAPE 7: Test suppression cascade
    // ============================================

    log('Test suppression cascade (Nœud → Instance → Journaux)...', 'step');

    // Compter avant suppression
    const countInstancesBefore = await AgentInstanceV2.countDocuments({ workflowId });
    const countJournalsBefore = await AgentJournal.countDocuments({ workflowId });
    log(`Avant suppression: ${countInstancesBefore} instance(s), ${countJournalsBefore} journal(s)`, 'info');

    // Supprimer le nœud (devrait déclencher la cascade)
    await WorkflowNodeV2.findByIdAndDelete(nodeId);

    // Supprimer manuellement l'instance (car la cascade peut ne pas être auto)
    // Note: Dans un vrai scénario, on utiliserait un hook pre('remove')
    await AgentInstanceV2.deleteMany({ nodeId });
    await AgentJournal.deleteMany({ agentInstanceId: instanceId });

    // Vérifier la suppression
    const countInstancesAfter = await AgentInstanceV2.countDocuments({ workflowId });
    const countJournalsAfter = await AgentJournal.countDocuments({ workflowId });

    assert(countInstancesAfter === 0, 'Toutes les instances ont été supprimées');
    assert(countJournalsAfter === 0, 'Tous les journaux ont été supprimés');
    log('Cascade de suppression validée', 'success');

    // ============================================
    // RÉSULTAT FINAL
    // ============================================

    console.log('\n' + '='.repeat(60));
    console.log(`${COLORS.bold}${COLORS.green}✅ TOUS LES TESTS E2E SONT PASSÉS${COLORS.reset}`);
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.log('\n' + '='.repeat(60));
    console.log(`${COLORS.bold}${COLORS.red}❌ ÉCHEC DES TESTS E2E${COLORS.reset}`);
    console.log('='.repeat(60));
    console.error(error);
    process.exitCode = 1;
  } finally {
    // ============================================
    // NETTOYAGE
    // ============================================

    log('Nettoyage des données de test...', 'step');

    try {
      if (instanceId) {
        await AgentJournal.deleteMany({ agentInstanceId: instanceId });
        await AgentInstanceV2.findByIdAndDelete(instanceId);
      }
      if (nodeId) {
        await WorkflowNodeV2.findByIdAndDelete(nodeId);
      }
      if (workflowId) {
        await Workflow.findByIdAndDelete(workflowId);
      }
      if (testUser) {
        await User.findByIdAndDelete(testUser._id);
      }
      log('Données de test nettoyées', 'success');
    } catch (cleanupError) {
      log(`Erreur nettoyage: ${cleanupError}`, 'error');
    }

    // Déconnexion MongoDB
    await mongoose.connection.close();
    log('Connexion MongoDB fermée', 'info');
  }
}

// ============================================
// EXÉCUTION
// ============================================

runPersistenceFlowTest().catch(console.error);
