// Tests unitaires - LLMConfig Model + Encryption
import mongoose from 'mongoose';
import { LLMConfig, ILLMConfig } from '../models/LLMConfig.model';
import { User } from '../models/User.model';

describe('LLMConfig Model', () => {
    let testUserId: mongoose.Types.ObjectId;

    beforeAll(async () => {
        // Créer utilisateur test UNE FOIS pour toute la suite
        const user = await User.create({
            email: `llmconfig-test-${Date.now()}@test.com`,
            password: 'hashedpassword123',
            username: `llmconfigtest${Date.now()}`
        });
        testUserId = user._id as mongoose.Types.ObjectId;
        await LLMConfig.syncIndexes();
    }, 30000); // Timeout 30s

    beforeEach(async () => {
        // Nettoyer uniquement les configs (garder user)
        await LLMConfig.deleteMany({});
    });

    afterAll(async () => {
        // Nettoyer user après tous les tests
        await User.deleteMany({ _id: testUserId });
    });

    describe('Création configuration LLM', () => {
        it('doit créer une config LLM valide', async () => {
            const config = await LLMConfig.create({
                userId: testUserId,
                provider: 'OpenAI',
                enabled: true
            });

            expect(config).toBeDefined();
            expect(config.provider).toBe('OpenAI');
            expect(config.userId.toString()).toBe(testUserId.toString());
            expect(config.enabled).toBe(true);
        });

        it('doit échouer avec provider invalide', async () => {
            const configData = {
                userId: testUserId,
                provider: 'invalid-provider',
                enabled: true
            };

            await expect(LLMConfig.create(configData)).rejects.toThrow();
        });

        it('doit respecter contrainte unique userId + provider', async () => {
            await LLMConfig.create({
                userId: testUserId,
                provider: 'Gemini',
                enabled: true
            });

            // Tentative de créer doublon doit échouer
            await expect(
                LLMConfig.create({
                    userId: testUserId,
                    provider: 'Gemini',
                    enabled: true
                })
            ).rejects.toThrow(/E11000/); // MongoDB duplicate key error
        });
    });

    describe('Chiffrement API Key (AES-256-GCM)', () => {
        it('doit chiffrer une API key avec setApiKey', async () => {
            const config = await LLMConfig.create({
                userId: testUserId,
                provider: 'OpenAI',
                enabled: true
            });

            const plainKey = 'openai-test-key-placeholder';
            await config.setApiKey(plainKey);

            // Vérifier que clé est chiffrée (format: iv:salt:authTag:encryptedData)
            expect(config.apiKeyEncrypted).toBeDefined();
            expect(config.apiKeyEncrypted).not.toBe(plainKey);
            expect(config.apiKeyEncrypted?.split(':')).toHaveLength(4);
        });

        it('doit déchiffrer correctement l\'API key', async () => {
            const config = await LLMConfig.create({
                userId: testUserId,
                provider: 'Anthropic',
                enabled: true
            });

            const plainKey = 'anthropic-test-key-placeholder';
            await config.setApiKey(plainKey);
            await config.save();

            // Recharger depuis DB
            const reloaded = await LLMConfig.findById(config._id);
            const decryptedKey = await reloaded!.getDecryptedApiKey();

            expect(decryptedKey).toBe(plainKey);
        });

        it('doit gérer clés vides/null', async () => {
            const config = await LLMConfig.create({
                userId: testUserId,
                provider: 'Mistral',
                enabled: true
            });

            await config.setApiKey('');
            // Clé vide est chiffrée quand même
            expect(config.apiKeyEncrypted).toBeDefined();

            const decrypted = await config.getDecryptedApiKey();
            expect(decrypted).toBe(''); // Empty string déchiffrée
        });

        it('doit utiliser salt différent pour chaque chiffrement', async () => {
            const config1 = await LLMConfig.create({
                userId: testUserId,
                provider: 'OpenAI',
                enabled: true
            });

            const config2 = await LLMConfig.create({
                userId: testUserId,
                provider: 'Anthropic',
                enabled: true
            });

            const plainKey = 'same-key-for-both';
            await config1.setApiKey(plainKey);
            await config2.setApiKey(plainKey);

            // Même clé mais chiffrement différent (salt unique)
            expect(config1.apiKeyEncrypted).not.toBe(config2.apiKeyEncrypted);

            // Mais déchiffrement identique
            const decrypted1 = await config1.getDecryptedApiKey();
            const decrypted2 = await config2.getDecryptedApiKey();
            expect(decrypted1).toBe(decrypted2);
            expect(decrypted1).toBe(plainKey);
        });
    });

    describe('Sécurité - Détection manipulation', () => {
        it('doit échouer si apiKeyEncrypted est modifié manuellement', async () => {
            const config = await LLMConfig.create({
                userId: testUserId,
                provider: 'Gemini',
                enabled: true
            });

            await config.setApiKey('gemini-test-key-placeholder');
            await config.save();

            // Altération malveillante
            const originalEncrypted = config.apiKeyEncrypted as string;
            const [ivHex, saltHex, authTagHex, encryptedData] = originalEncrypted.split(':');
            const tamperedEncryptedData = `${encryptedData.slice(0, -1)}${encryptedData.endsWith('0') ? '1' : '0'}`;
            config.apiKeyEncrypted = [ivHex, saltHex, authTagHex, tamperedEncryptedData].join(':');
            await config.save();

            // Déchiffrement doit échouer (méthode synchrone)
            expect(() => config.getDecryptedApiKey()).toThrow();
        });
    });

    describe('Capabilities field', () => {
        it('doit stocker capabilities comme object', async () => {
            const config = await LLMConfig.create({
                userId: testUserId,
                provider: 'OpenAI',
                enabled: true,
                capabilities: { chat: true, imageGeneration: true }
            });

            expect(config.capabilities).toEqual({ chat: true, imageGeneration: true });
        });

        it('doit accepter objet vide par défaut', async () => {
            const config = await LLMConfig.create({
                userId: testUserId,
                provider: 'Perplexity',
                enabled: true
            });

            expect(config.capabilities).toEqual({});
        });
    });

    describe('Index', () => {
        it('doit avoir index unique sur userId + provider', async () => {
            const indexes = LLMConfig.schema.indexes();

            const uniqueIndex = indexes.find(
                (idx: any) => idx[0].userId && idx[0].provider && idx[1]?.unique
            );

            expect(uniqueIndex).toBeDefined();
        });

        it('doit avoir index sur enabled', async () => {
            const indexes = LLMConfig.schema.indexes();

            const enabledIndex = indexes.find(
                (idx: any) => idx[0].enabled
            );

            expect(enabledIndex).toBeDefined();
        });
    });
});
