/**
 * Tests Unitaires pour updateAgent()
 * 
 * Objectif : Valider le principe de non-affectation des instances existantes
 * lors de la modification d'un prototype.
 */

import { useDesignStore } from '../useDesignStore';
import { RobotId, LLMProvider, LLMCapability, Agent, AgentInstance } from '../../types';

describe('useDesignStore - updateAgent()', () => {
    beforeEach(() => {
        // Reset store avant chaque test
        const store = useDesignStore.getState();
        store.agents = [];
        store.agentInstances = [];
        store.nodes = [];
        store.edges = [];
        store.selectedAgentId = null;
        store.currentRobotId = RobotId.Archi;
    });

    describe('Principe de Non-Affectation des Instances Existantes', () => {
        it('doit modifier UNIQUEMENT la définition du prototype, sans toucher aux instances', () => {
            const store = useDesignStore.getState();

            // 1. Créer un prototype initial
            const prototypeResult = store.addAgent({
                name: 'Expert Marketing V1',
                role: 'Marketing Specialist',
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash-exp',
                systemPrompt: 'Tu es un expert marketing v1.',
                capabilities: [LLMCapability.TextGeneration],
                tools: [],
                outputConfig: { format: 'text', temperature: 0.7 },
                historyConfig: { enabled: false }
            });

            expect(prototypeResult.success).toBe(true);
            const prototypeId = store.agents[0].id;

            // 2. Créer 2 instances de ce prototype
            const instance1: AgentInstance = {
                id: 'inst-1',
                prototypeId: prototypeId,
                name: 'Expert Marketing V1 - Instance Custom',
                role: 'Marketing Specialist',
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash-exp',
                systemPrompt: 'Configuration personnalisée instance 1.',
                capabilities: [LLMCapability.TextGeneration],
                tools: [],
                outputConfig: { format: 'text', temperature: 0.9 }, // Température personnalisée
                historyConfig: { enabled: false },
                position: { x: 100, y: 100 },
                messages: [{ id: 'msg-hist-1', sender: 'user', text: 'Message historique', timestamp: new Date() }],
                created_at: new Date().toISOString()
            };

            const instance2: AgentInstance = {
                id: 'inst-2',
                prototypeId: prototypeId,
                name: 'Expert Marketing V1',
                role: 'Marketing Specialist',
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash-exp',
                systemPrompt: 'Configuration personnalisée instance 2.',
                capabilities: [LLMCapability.TextGeneration, LLMCapability.ImageGeneration],
                tools: [],
                outputConfig: { format: 'json', temperature: 0.5 },
                historyConfig: { enabled: true },
                position: { x: 300, y: 200 },
                messages: [],
                created_at: new Date().toISOString()
            };

            store.addAgentInstance(instance1);
            store.addAgentInstance(instance2);

            // 3. Déployer ces instances sur le workflow
            store.addNode({
                type: 'customAgent',
                position: { x: 100, y: 100 },
                data: {
                    agentInstance: instance1,
                    robotId: RobotId.Archi,
                    label: instance1.name
                }
            });

            store.addNode({
                type: 'customAgent',
                position: { x: 300, y: 200 },
                data: {
                    agentInstance: instance2,
                    robotId: RobotId.Archi,
                    label: instance2.name
                }
            });

            // Snapshot de l'état AVANT modification
            const instancesBeforeUpdate = JSON.parse(JSON.stringify(store.agentInstances));
            const nodesBeforeUpdate = JSON.parse(JSON.stringify(store.nodes));

            // 4. Modifier le prototype (changements majeurs)
            const updateResult = store.updateAgent(prototypeId, {
                name: 'Expert Marketing V2 - UPDATED',
                role: 'Senior Marketing Director',
                systemPrompt: 'Tu es un expert marketing v2 avec de nouvelles capacités.',
                model: 'gemini-2.5-pro',
                capabilities: [LLMCapability.TextGeneration, LLMCapability.WebGrounding],
                outputConfig: { format: 'markdown', temperature: 0.3 }
            });

            expect(updateResult.success).toBe(true);

            // Snapshot de l'état APRÈS modification
            const instancesAfterUpdate = store.agentInstances;
            const nodesAfterUpdate = store.nodes;

            // 5. ASSERTIONS CRITIQUES : Non-Affectation Stricte

            // 5.1. Le prototype doit être modifié
            const updatedPrototype = store.agents.find(a => a.id === prototypeId);
            expect(updatedPrototype?.name).toBe('Expert Marketing V2 - UPDATED');
            expect(updatedPrototype?.role).toBe('Senior Marketing Director');
            expect(updatedPrototype?.systemPrompt).toBe('Tu es un expert marketing v2 avec de nouvelles capacités.');
            expect(updatedPrototype?.model).toBe('gemini-2.5-pro');

            // 5.2. Les instances doivent rester IDENTIQUES (deep equality)
            expect(instancesAfterUpdate).toEqual(instancesBeforeUpdate);

            // 5.3. Vérifications granulaires sur chaque instance
            const inst1After = instancesAfterUpdate.find(i => i.id === 'inst-1');
            const inst2After = instancesAfterUpdate.find(i => i.id === 'inst-2');

            // Instance 1 : configurations personnalisées préservées
            expect(inst1After?.name).toBe('Expert Marketing V1 - Instance Custom'); // Nom non modifié
            expect(inst1After?.systemPrompt).toBe('Configuration personnalisée instance 1.'); // Prompt non modifié
            expect(inst1After?.outputConfig.temperature).toBe(0.9); // Température personnalisée préservée
            expect(inst1After?.messages).toEqual([expect.objectContaining({ id: 'msg-hist-1', sender: 'user', text: 'Message historique' })]); // Historique préservé (avec timestamp)

            // Instance 2 : configurations personnalisées préservées
            expect(inst2After?.name).toBe('Expert Marketing V1'); // Nom non modifié même s'il correspondait au prototype
            expect(inst2After?.systemPrompt).toBe('Configuration personnalisée instance 2.');
            expect(inst2After?.outputConfig.format).toBe('json'); // Format personnalisé préservé
            expect(inst2After?.capabilities.length).toBe(2); // Capacités personnalisées préservées
            expect(inst2After?.historyConfig.enabled).toBe(true); // Config historique préservée

            // 5.4. Les nodes du workflow doivent rester IDENTIQUES
            expect(nodesAfterUpdate).toEqual(nodesBeforeUpdate);

            // 5.5. Vérifier que le nombre d'instances n'a pas changé
            expect(instancesAfterUpdate.length).toBe(2);
            expect(nodesAfterUpdate.length).toBe(2);
        });

        it('doit compter correctement les instances déployées (excluant les orphelines)', () => {
            const store = useDesignStore.getState();

            // Créer un prototype
            store.addAgent({
                name: 'Test Agent',
                role: 'Tester',
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash-exp',
                systemPrompt: 'Test prompt',
                capabilities: [LLMCapability.TextGeneration],
                tools: [],
                outputConfig: { format: 'text', temperature: 0.7 },
                historyConfig: { enabled: false }
            });

            const prototypeId = store.agents[0].id;

            // Créer 3 instances
            const instance1: AgentInstance = {
                id: 'inst-1',
                prototypeId: prototypeId,
                name: 'Instance 1',
                role: 'Tester',
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash-exp',
                systemPrompt: 'Test',
                capabilities: [LLMCapability.TextGeneration],
                tools: [],
                outputConfig: { format: 'text', temperature: 0.7 },
                historyConfig: { enabled: false },
                position: { x: 0, y: 0 },
                messages: [],
                created_at: new Date().toISOString()
            };

            const instance2: AgentInstance = { ...instance1, id: 'inst-2', name: 'Instance 2' };
            const instance3: AgentInstance = { ...instance1, id: 'inst-3', name: 'Instance 3 (Orpheline)' };

            store.addAgentInstance(instance1);
            store.addAgentInstance(instance2);
            store.addAgentInstance(instance3);

            // Déployer seulement 2 instances sur le workflow (instance3 reste orpheline)
            store.addNode({
                type: 'customAgent',
                position: { x: 100, y: 100 },
                data: { agentInstance: instance1, robotId: RobotId.Archi, label: 'Node 1' }
            });

            store.addNode({
                type: 'customAgent',
                position: { x: 200, y: 200 },
                data: { agentInstance: instance2, robotId: RobotId.Archi, label: 'Node 2' }
            });

            // Vérifier l'impact
            const impact = store.getPrototypeImpact(prototypeId);

            // Doit compter SEULEMENT les 2 instances déployées, pas l'orpheline
            expect(impact.instanceCount).toBe(2);
            expect(impact.nodeCount).toBe(2);
            expect(impact.instances.length).toBe(2);
            expect(impact.instances.map(i => i.id)).toEqual(['inst-1', 'inst-2']);
        });

        it('doit permettre la création de nouvelles instances avec la nouvelle définition', () => {
            const store = useDesignStore.getState();

            // Créer prototype V1
            store.addAgent({
                name: 'Prototype V1',
                role: 'Role V1',
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash-exp',
                systemPrompt: 'Prompt V1',
                capabilities: [LLMCapability.TextGeneration],
                tools: [],
                outputConfig: { format: 'text', temperature: 0.7 },
                historyConfig: { enabled: false }
            });

            const prototypeId = store.agents[0].id;

            // Créer une instance avec V1
            const instanceV1: AgentInstance = {
                id: 'inst-v1',
                prototypeId: prototypeId,
                name: 'Prototype V1',
                role: 'Role V1',
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash-exp',
                systemPrompt: 'Prompt V1',
                capabilities: [LLMCapability.TextGeneration],
                tools: [],
                outputConfig: { format: 'text', temperature: 0.7 },
                historyConfig: { enabled: false },
                position: { x: 0, y: 0 },
                messages: [],
                created_at: new Date().toISOString()
            };

            store.addAgentInstance(instanceV1);

            // Mettre à jour le prototype vers V2
            store.updateAgent(prototypeId, {
                name: 'Prototype V2',
                systemPrompt: 'Prompt V2',
                model: 'gemini-2.5-pro'
            });

            // Vérifier que le prototype a bien V2
            const prototype = store.agents.find(a => a.id === prototypeId);
            expect(prototype?.name).toBe('Prototype V2');
            expect(prototype?.systemPrompt).toBe('Prompt V2');
            expect(prototype?.model).toBe('gemini-2.5-pro');

            // Vérifier que l'instance V1 est restée inchangée
            const instanceAfter = store.agentInstances.find(i => i.id === 'inst-v1');
            expect(instanceAfter?.name).toBe('Prototype V1');
            expect(instanceAfter?.systemPrompt).toBe('Prompt V1');
            expect(instanceAfter?.model).toBe('gemini-2.0-flash-exp');

            // Simuler la création d'une nouvelle instance APRÈS la modification
            // (cette logique se ferait normalement via addAgentInstance avec les données du prototype V2)
            const prototypeV2 = store.agents.find(a => a.id === prototypeId)!;
            const instanceV2: AgentInstance = {
                id: 'inst-v2',
                prototypeId: prototypeId,
                name: prototypeV2.name,
                role: prototypeV2.role,
                llmProvider: prototypeV2.llmProvider,
                model: prototypeV2.model,
                systemPrompt: prototypeV2.systemPrompt,
                capabilities: prototypeV2.capabilities,
                tools: prototypeV2.tools,
                outputConfig: prototypeV2.outputConfig,
                historyConfig: prototypeV2.historyConfig,
                position: { x: 100, y: 100 },
                messages: [],
                created_at: new Date().toISOString()
            };

            store.addAgentInstance(instanceV2);

            // Vérifier que la nouvelle instance utilise bien V2
            const newInstance = store.agentInstances.find(i => i.id === 'inst-v2');
            expect(newInstance?.name).toBe('Prototype V2');
            expect(newInstance?.systemPrompt).toBe('Prompt V2');
            expect(newInstance?.model).toBe('gemini-2.5-pro');

            // Confirmer que les 2 instances coexistent avec des définitions différentes
            expect(store.agentInstances.length).toBe(2);
            expect(store.agentInstances[0].systemPrompt).toBe('Prompt V1'); // Ancienne instance
            expect(store.agentInstances[1].systemPrompt).toBe('Prompt V2'); // Nouvelle instance
        });
    });
});
