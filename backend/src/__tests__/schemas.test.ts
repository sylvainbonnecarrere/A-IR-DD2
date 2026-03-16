/**
 * Test unitaire - Schémas Zod ÉTAPE 1.6
 * 
 * Valide que les schémas de persistence contract fonctionnent correctement.
 * Exécuter avec: npx jest src/__tests__/schemas.test.ts
 */

import {
    // Agent schemas
    AgentCreateSchema,
    validateAgentCreate,
    safeValidateAgentCreate,
    // Agent Instance schemas
    AgentInstanceCreateSchema,
    AgentInstanceContentSchema,
    validateAgentInstanceContent,
    createChatContent,
    createErrorContent,
    // Workflow schemas
    WorkflowCreateSchema,
    WorkflowSaveSchema,
    validateWorkflowCreate
} from '../schemas';

describe('Agent Schemas (ÉTAPE 1.6)', () => {
    describe('AgentCreateSchema', () => {
        it('should validate a valid agent', () => {
            const validAgent = {
                name: 'Test Agent',
                role: 'Assistant',
                systemPrompt: 'You are a helpful assistant.',
                llmProvider: 'Mistral',
                llmModel: 'mistral-large',
                robotId: 'AR_001',
                position: { x: 100, y: 200 }
            };

            const result = AgentCreateSchema.safeParse(validAgent);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.name).toBe('Test Agent');
                expect(result.data.robotId).toBe('AR_001');
            }
        });

        it('should reject invalid robotId', () => {
            const invalidAgent = {
                name: 'Test Agent',
                role: 'Assistant',
                systemPrompt: 'You are a helpful assistant.',
                llmProvider: 'Mistral',
                llmModel: 'mistral-large',
                robotId: 'INVALID_ROBOT' // Invalid!
            };

            const result = safeValidateAgentCreate(invalidAgent);
            expect(result.success).toBe(false);
        });

        it('should accept canonical non-Archi robotId values', () => {
            const validAgent = {
                name: 'Bos Agent',
                role: 'Supervisor',
                systemPrompt: 'You monitor workflow execution.',
                llmProvider: 'Mistral',
                llmModel: 'mistral-large',
                robotId: 'BO_002'
            };

            const result = safeValidateAgentCreate(validAgent);
            expect(result.success).toBe(true);
        });

        it('should reject obsolete robotId alphabet values', () => {
            const obsoleteBosRobotId = ['BOS', '001'].join('_');
            const obsoleteAgent = {
                name: 'Legacy Bos Agent',
                role: 'Supervisor',
                systemPrompt: 'Legacy robot id must be rejected.',
                llmProvider: 'Mistral',
                llmModel: 'mistral-large',
                robotId: obsoleteBosRobotId
            };

            const result = safeValidateAgentCreate(obsoleteAgent);
            expect(result.success).toBe(false);
        });

        it('should reject empty name', () => {
            const invalidAgent = {
                name: '', // Empty!
                role: 'Assistant',
                systemPrompt: 'You are a helpful assistant.',
                llmProvider: 'Mistral',
                llmModel: 'mistral-large',
                robotId: 'AR_001'
            };

            const result = safeValidateAgentCreate(invalidAgent);
            expect(result.success).toBe(false);
        });

        it('should provide default position', () => {
            const agentWithoutPosition = {
                name: 'Test Agent',
                role: 'Assistant',
                systemPrompt: 'You are a helpful assistant.',
                llmProvider: 'Mistral',
                llmModel: 'mistral-large',
                robotId: 'AR_001'
            };

            const result = validateAgentCreate(agentWithoutPosition);
            expect(result.position).toEqual({ x: 0, y: 0 });
        });
    });
});

describe('AgentInstance Schemas (ÉTAPE 1.6)', () => {
    describe('Content Polymorphe', () => {
        it('should validate chat content', () => {
            const chatContent = {
                type: 'chat' as const,
                role: 'user' as const,
                message: 'Hello!',
                timestamp: new Date()
            };

            const result = AgentInstanceContentSchema.safeParse(chatContent);
            expect(result.success).toBe(true);
        });

        it('should validate image content', () => {
            const imageContent = {
                type: 'image' as const,
                mediaId: '550e8400-e29b-41d4-a716-446655440000',
                prompt: 'A beautiful sunset',
                url: 'https://example.com/image.png',
                timestamp: new Date(),
                metadata: {
                    model: 'dalle-3',
                    size: '1024x1024'
                }
            };

            const result = AgentInstanceContentSchema.safeParse(imageContent);
            expect(result.success).toBe(true);
        });

        it('should validate error content', () => {
            const errorContent = {
                type: 'error' as const,
                subType: 'llm_timeout' as const,
                message: 'Request timed out after 30s',
                timestamp: new Date(),
                metadata: {
                    source: 'llm_service' as const,
                    retryable: true,
                    attempts: 3
                }
            };

            const result = AgentInstanceContentSchema.safeParse(errorContent);
            expect(result.success).toBe(true);
        });

        it('should reject invalid mediaId (not UUID)', () => {
            const invalidImage = {
                type: 'image' as const,
                mediaId: 'not-a-uuid', // Invalid!
                prompt: 'A beautiful sunset',
                url: 'https://example.com/image.png',
                timestamp: new Date(),
                metadata: {
                    model: 'dalle-3',
                    size: '1024x1024'
                }
            };

            const result = AgentInstanceContentSchema.safeParse(invalidImage);
            expect(result.success).toBe(false);
        });
    });

    describe('Helper Functions', () => {
        it('should create chat content correctly', () => {
            const content = createChatContent('user', 'Hello!', { tokensUsed: 10 });
            
            expect(content.type).toBe('chat');
            expect(content.role).toBe('user');
            expect(content.message).toBe('Hello!');
            expect(content.metadata?.tokensUsed).toBe(10);
            expect(content.timestamp).toBeInstanceOf(Date);
        });

        it('should create error content correctly', () => {
            const content = createErrorContent(
                'api_rate_limit',
                'Too many requests',
                'llm_service',
                true,
                5,
                'RATE_LIMIT_EXCEEDED'
            );
            
            expect(content.type).toBe('error');
            expect(content.subType).toBe('api_rate_limit');
            expect(content.metadata.retryable).toBe(true);
            expect(content.metadata.attempts).toBe(5);
            expect(content.metadata.errorCode).toBe('RATE_LIMIT_EXCEEDED');
        });
    });

    describe('AgentInstanceCreateSchema', () => {
        it('should validate a valid instance', () => {
            const validInstance = {
                agentId: '507f1f77bcf86cd799439011',
                workflowId: '507f1f77bcf86cd799439012',
                executionId: 'run-123456',
                status: 'running' as const
            };

            const result = AgentInstanceCreateSchema.safeParse(validInstance);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.content).toEqual([]); // Default empty array
            }
        });
    });
});

describe('Workflow Schemas (ÉTAPE 1.6)', () => {
    describe('WorkflowCreateSchema', () => {
        it('should validate a valid workflow', () => {
            const validWorkflow = {
                name: 'My Workflow',
                description: 'A test workflow',
                isDefault: true
            };

            const result = WorkflowCreateSchema.safeParse(validWorkflow);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.canvasState).toEqual({
                    zoom: 1,
                    panX: 0,
                    panY: 0
                });
            }
        });

        it('should reject name exceeding max length', () => {
            const invalidWorkflow = {
                name: 'A'.repeat(101), // 101 chars, max is 100
                isDefault: true
            };

            const result = WorkflowCreateSchema.safeParse(invalidWorkflow);
            expect(result.success).toBe(false);
        });
    });

    describe('WorkflowSaveSchema (Manual Save)', () => {
        it('should validate save data with nodes and edges', () => {
            const saveData = {
                nodes: [
                    {
                        id: 'node-1',
                        type: 'agentNode',
                        position: { x: 100, y: 200 },
                        data: { agentId: 'agent-1' }
                    }
                ],
                edges: [
                    {
                        id: 'edge-1',
                        source: 'node-1',
                        target: 'node-2'
                    }
                ],
                canvasState: {
                    zoom: 1.5,
                    panX: 50,
                    panY: -30
                }
            };

            const result = WorkflowSaveSchema.safeParse(saveData);
            expect(result.success).toBe(true);
        });
    });
});

describe('Integration: Content Validation', () => {
    it('should validate mixed content array', () => {
        const mixedContent = [
            createChatContent('user', 'Generate an image'),
            {
                type: 'image' as const,
                mediaId: '550e8400-e29b-41d4-a716-446655440000',
                prompt: 'A sunset',
                url: 'https://example.com/sunset.png',
                timestamp: new Date(),
                metadata: { model: 'dalle-3', size: '1024x1024' }
            },
            createChatContent('agent', 'Image generated successfully!'),
            createErrorContent('network_error', 'Connection lost', 'llm_service', true, 1)
        ];

        // Valider chaque élément
        mixedContent.forEach((content, index) => {
            const result = validateAgentInstanceContent(content);
            expect(result.type).toBeDefined();
        });
    });
});
