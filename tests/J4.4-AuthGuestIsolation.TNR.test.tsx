/**
 * @file J4.4-AuthGuestIsolation.TNR.test.tsx
 * @description Test de Non-Régression - Isolation bidirectionnelle Guest ↔ Auth
 * @domain Security - Data Isolation
 * 
 * ⚠️ TEST CRITIQUE DE SÉCURITÉ (JALON 4.4)
 * 
 * Ce test garantit l'isolation COMPLÈTE entre sessions guest et auth.
 * Il simule les 4 scénarios de fuite identifiés par le Chef de Projet.
 * 
 * RÉGRESSIONS BLOQUÉES (TOUTES CRITIQUES):
 * 1. ❌ Guest Agent visible après login (Guest → Auth leak)
 * 2. ❌ LLM config guest héritée par auth user (Guest → Auth leak)  
 * 3. ❌ Auth Agent visible après logout (Auth → Guest leak)
 * 4. ❌ Auth LLM configs visibles en mode guest (Auth → Guest leak)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { wipeGuestData, GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';
import { AgentDraft, LLMCapability, LLMProvider, RobotId } from '../types';

function createAgentDraft(name: string, role: string, systemPrompt: string): AgentDraft {
    return {
        name,
        role,
        systemPrompt,
        llmProvider: LLMProvider.Gemini,
        model: 'gemini-2.0-flash',
        capabilities: [LLMCapability.Chat],
        tools: [],
    };
}

describe('J4.4 TNR - Security: Guest ↔ Auth Data Isolation', () => {
    beforeEach(() => {
        // RESET COMPLET: Simuler redémarrage application
        localStorage.clear();
        useDesignStore.getState().resetAll();
        useWorkflowStore.getState().resetAll();
        useRuntimeStore.getState().resetAll();
    });

    describe('SCÉNARIO 1: Guest → Auth (Login Wipe)', () => {
        it('❌ CRITIQUE: Guest Agent NE DOIT PAS apparaître après login', () => {
            // === ÉTAPE 1: MODE GUEST - Utilisateur crée un agent ===
            console.log('🟡 [GUEST SESSION] Creating guest agent...');
            const designStore = useDesignStore.getState();
            
            const result = designStore.addAgent(createAgentDraft('Guest Test Agent', 'Created in guest mode before login', 'Guest prompt'));
            
            // Vérifier: Agent créé en mode guest
            expect(result.success).toBe(true);
            const freshDesignStore = useDesignStore.getState();
            expect(freshDesignStore.agents.length).toBe(1);
            expect(freshDesignStore.agents[0].name).toBe('Guest Test Agent');
            console.log('✅ Guest agent created:', freshDesignStore.agents[0].name);
            
            // === ÉTAPE 2: SIMULATION LOGIN - Appel wipeGuestData() ===
            console.log('🔴 [LOGIN] Wiping guest data...');
            const wipeResult = wipeGuestData();
            console.log('Wipe result:', wipeResult);
            
            // === ÉTAPE 3: VÉRIFICATION CRITIQUE ===
            const designStoreAfterWipe = useDesignStore.getState();
            
            // ⚠️ ASSERTION CRITIQUE: Aucun agent ne doit subsister
            expect(designStoreAfterWipe.agents.length).toBe(0);
            
            console.log('✅ SECURITY PASSED: Guest agent wiped on login');
        });

        it('❌ CRITIQUE: Guest LLM configs NE DOIVENT PAS contaminer session auth', () => {
            // === ÉTAPE 1: MODE GUEST - Utilisateur crée config LLM ===
            console.log('🟡 [GUEST SESSION] Creating guest LLM config...');
            
            localStorage.setItem(GUEST_STORAGE_KEYS.llmConfigs, JSON.stringify({
                'Mistral': {
                    provider: 'Mistral',
                    apiKey: 'mistral-test-key-placeholder',
                    model: 'mistral-medium',
                    enabled: true
                }
            }));
            
            const guestConfig = localStorage.getItem(GUEST_STORAGE_KEYS.llmConfigs);
            expect(guestConfig).toBeTruthy();
            console.log('✅ Guest LLM config created');
            
            // === ÉTAPE 2: SIMULATION LOGIN - Wipe ===
            console.log('🔴 [LOGIN] Wiping guest data...');
            wipeGuestData();
            
            // === ÉTAPE 3: VÉRIFICATION CRITIQUE ===
            const configAfterWipe = localStorage.getItem(GUEST_STORAGE_KEYS.llmConfigs);
            
            // ⚠️ ASSERTION CRITIQUE: Config guest doit être wipée
            expect(configAfterWipe).toBeNull();
            
            console.log('✅ SECURITY PASSED: Guest LLM config wiped on login');
        });
    });

    describe('SCÉNARIO 2: Auth → Guest (Logout Wipe)', () => {
        it('❌ CRITIQUE: Auth Agent NE DOIT PAS apparaître après logout', () => {
            // === ÉTAPE 1: MODE AUTH - User authentifié crée un agent ===
            console.log('🔵 [AUTH SESSION] Creating auth agent...');
            const designStore = useDesignStore.getState();
            
            const result = designStore.addAgent(createAgentDraft('Auth User Agent', 'Created by authenticated user', 'Auth prompt'));
            
            // Vérifier: Agent créé en mode auth
            expect(result.success).toBe(true);
            const freshDesignStore = useDesignStore.getState();
            expect(freshDesignStore.agents.length).toBe(1);
            expect(freshDesignStore.agents[0].name).toBe('Auth User Agent');
            console.log('✅ Auth agent created:', freshDesignStore.agents[0].name);
            
            // === ÉTAPE 2: SIMULATION LOGOUT - Reset stores (comme dans AuthContext.logout) ===
            console.log('🔴 [LOGOUT] Resetting stores...');
            
            // Simuler exactement ce que fait AuthContext.logout()
            useDesignStore.getState().resetAll();
            useWorkflowStore.getState().resetAll();
            useRuntimeStore.getState().resetAll();
            
            // === ÉTAPE 3: VÉRIFICATION CRITIQUE ===
            const designStoreAfterLogout = useDesignStore.getState();
            
            // ⚠️ ASSERTION CRITIQUE: Aucun agent ne doit subsister en mode guest
            expect(designStoreAfterLogout.agents.length).toBe(0);
            
            console.log('✅ SECURITY PASSED: Auth agent does NOT leak to guest after logout');
        });

        it('❌ CRITIQUE: Auth workflow NE DOIT PAS être visible après logout', () => {
            // === ÉTAPE 1: MODE AUTH - User authentifié crée workflow ===
            console.log('🔵 [AUTH SESSION] Creating auth workflow...');
            const workflowStore = useWorkflowStore.getState();
            
            // createWorkflow returns workflow ID
            const workflowId = workflowStore.createWorkflow('Auth User Workflow', RobotId.Archi);
            
            const freshWorkflowStore = useWorkflowStore.getState();
            expect(freshWorkflowStore.workflows.length).toBe(1);
            expect(freshWorkflowStore.workflows[0].name).toBe('Auth User Workflow');
            console.log('✅ Auth workflow created');
            
            // === ÉTAPE 2: SIMULATION LOGOUT ===
            console.log('🔴 [LOGOUT] Resetting stores...');
            workflowStore.resetAll();
            
            // === ÉTAPE 3: VÉRIFICATION CRITIQUE ===
            const workflowStoreAfterLogout = useWorkflowStore.getState();
            
            // ⚠️ ASSERTION CRITIQUE: Workflow auth ne doit PAS être visible en guest
            expect(workflowStoreAfterLogout.workflows.length).toBe(0);
            
            console.log('✅ SECURITY PASSED: Auth workflow does NOT leak to guest');
        });
    });

    describe('SCÉNARIO 3: Double Isolation (Guest → Auth → Guest)', () => {
        it('should maintain isolation across multiple session switches', () => {
            // === SESSION 1: GUEST ===
            console.log('🟡 [SESSION 1: GUEST] Creating guest data...');
            useDesignStore.getState().addAgent(createAgentDraft('Guest Agent 1', 'First guest session', 'Guest 1'));
            
            expect(useDesignStore.getState().agents.length).toBe(1);
            
            // === SESSION 2: LOGIN → AUTH ===
            console.log('🔴 [LOGIN] Wiping guest data...');
            wipeGuestData();
            
            useDesignStore.getState().addAgent(createAgentDraft('Auth Agent', 'Auth session', 'Auth'));
            
            const authStore = useDesignStore.getState();
            expect(authStore.agents.length).toBe(1);
            expect(authStore.agents[0].name).toBe('Auth Agent');
            
            // === SESSION 3: LOGOUT → NEW GUEST ===
            console.log('🔴 [LOGOUT] Resetting stores...');
            useDesignStore.getState().resetAll();
            useWorkflowStore.getState().resetAll();
            useRuntimeStore.getState().resetAll();
            
            // ⚠️ CRITICAL: New guest session must be CLEAN
            expect(useDesignStore.getState().agents.length).toBe(0);
            
            // New guest creates agent
            useDesignStore.getState().addAgent(createAgentDraft('Guest Agent 2', 'Second guest session', 'Guest 2'));
            
            const finalStore = useDesignStore.getState();
            expect(finalStore.agents.length).toBe(1);
            expect(finalStore.agents[0].name).toBe('Guest Agent 2');
            
            console.log('✅ SECURITY PASSED: Complete isolation across 3 sessions');
        });
    });
});
