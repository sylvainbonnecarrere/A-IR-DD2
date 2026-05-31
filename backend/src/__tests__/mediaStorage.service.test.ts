/**
 * @fileoverview Tests unitaires - MediaStorageService (Jalon 5)
 * 
 * Teste la validation des fichiers et les modes de stockage
 * 
 * @see backend/src/services/mediaStorage.service.ts
 */

import path from 'path';
import fs from 'fs/promises';
import { MediaStorageService, MediaStorageError } from '../services/mediaStorage.service';
import { DEFAULT_PERSISTENCE_CONFIG, MAX_DATABASE_MEDIA_SIZE } from '../types/persistence';
import { CloudConnectionProfile } from '../models/CloudConnectionProfile.model';
import { S3StorageStrategy } from '../services/s3Storage.service';

// Répertoire temporaire pour tests
const TEST_STORAGE_ROOT = path.join(process.cwd(), 'storage-test-temp');

describe('MediaStorageService - Validation et stockage', () => {
    let mediaService: MediaStorageService;

    beforeAll(async () => {
        // Créer le répertoire de test
        await fs.mkdir(TEST_STORAGE_ROOT, { recursive: true });
        
        mediaService = new MediaStorageService({
            storageRoot: TEST_STORAGE_ROOT,
            createDirectories: true,
            validateMimeTypes: true,
            generateChecksums: true
        });
    });

    afterAll(async () => {
        // Nettoyer le répertoire de test
        try {
            await fs.rm(TEST_STORAGE_ROOT, { recursive: true, force: true });
        } catch (error) {
            console.warn('Cleanup warning:', error);
        }
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ============================================
    // CAS 1: Fichiers > 16MB en mode 'database'
    // ============================================

    describe('Cas 1: Validation taille fichier en mode database', () => {
        it('doit rejeter les fichiers > 16MB en mode database', async () => {
            // Créer un buffer simulant un fichier > 16MB
            // NOTE: On utilise une taille juste au-dessus de la limite pour le test
            const oversizedBuffer = Buffer.alloc(MAX_DATABASE_MEDIA_SIZE + 1024); // 16MB + 1KB

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: 'large-image.png',
                mimeType: 'image/png',
                size: oversizedBuffer.length
            };

            const context = {
                userId: 'test-user-123',
                workflowId: 'test-workflow-456',
                agentInstanceId: 'test-instance-789'
            };

            // Vérifier que l'erreur est bien lancée
            await expect(
                mediaService.saveMedia(oversizedBuffer, metadata, config, context)
            ).rejects.toThrow(MediaStorageError);

            // Vérifier le code d'erreur
            try {
                await mediaService.saveMedia(oversizedBuffer, metadata, config, context);
            } catch (error) {
                expect(error).toBeInstanceOf(MediaStorageError);
                expect((error as MediaStorageError).code).toBe('FILE_TOO_LARGE');
                expect((error as MediaStorageError).details?.recommendation).toContain('local');
            }
        });

        it('doit accepter les fichiers < 16MB en mode database', async () => {
            // Créer un petit buffer (1KB)
            const smallBuffer = Buffer.alloc(1024);
            smallBuffer.fill('A');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: 'small-image.png',
                mimeType: 'image/png',
                size: smallBuffer.length
            };

            const context = {
                userId: 'test-user-123',
                workflowId: 'test-workflow-456',
                agentInstanceId: 'test-instance-789'
            };

            const result = await mediaService.saveMedia(smallBuffer, metadata, config, context);

            expect(result).toBeDefined();
            expect(result.storageMode).toBe('database');
            expect(result.data).toBeDefined();
            expect(result.size).toBe(1024);
            expect(result.checksum).toBeDefined();
        });

        it('doit accepter exactement 16MB en mode database', async () => {
            // Buffer de exactement 16MB (limite maximale)
            const maxBuffer = Buffer.alloc(MAX_DATABASE_MEDIA_SIZE);
            maxBuffer.fill('B');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: 'max-size-image.png',
                mimeType: 'image/png',
                size: maxBuffer.length
            };

            const context = {
                userId: 'test-user-123',
                workflowId: 'test-workflow-456',
                agentInstanceId: 'test-instance-789'
            };

            const result = await mediaService.saveMedia(maxBuffer, metadata, config, context);

            expect(result.storageMode).toBe('database');
            expect(result.size).toBe(MAX_DATABASE_MEDIA_SIZE);
        });
    });

    // ============================================
    // CAS 2: Stockage local
    // ============================================

    describe('Cas 2: Stockage mode local', () => {
        it('doit sauvegarder sur disque avec le bon chemin', async () => {
            const testBuffer = Buffer.from('Test image content for local storage');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'local' as const
            };

            const metadata = {
                originalName: 'test-local-image.png',
                mimeType: 'image/png',
                size: testBuffer.length
            };

            const context = {
                userId: 'user-local-test',
                workflowId: 'workflow-local-test',
                agentInstanceId: 'instance-local-test'
            };

            const result = await mediaService.saveMedia(testBuffer, metadata, config, context);

            expect(result.storageMode).toBe('local');
            expect(result.path).toBeDefined();
            expect(result.path).toContain('user-local-test');
            expect(result.path).toContain('workflow-local-test');
            expect(result.path).toContain('instance-local-test');
            expect(result.checksum).toBeDefined();

            // Vérifier que le fichier existe sur disque
            const fullPath = path.join(TEST_STORAGE_ROOT, result.path!);
            const fileExists = await fs.access(fullPath).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);

            // Vérifier le contenu
            const savedContent = await fs.readFile(fullPath);
            expect(savedContent.toString()).toBe('Test image content for local storage');
        });

        it('doit accepter les gros fichiers en mode local', async () => {
            // Buffer de 20MB (plus grand que la limite database)
            const largeBuffer = Buffer.alloc(20 * 1024 * 1024);
            largeBuffer.fill('C');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'local' as const
            };

            const metadata = {
                originalName: 'large-local-file.pdf',
                mimeType: 'application/pdf',
                size: largeBuffer.length
            };

            const context = {
                userId: 'user-large-test',
                workflowId: 'workflow-large-test',
                agentInstanceId: 'instance-large-test'
            };

            const result = await mediaService.saveMedia(largeBuffer, metadata, config, context);

            expect(result.storageMode).toBe('local');
            expect(result.size).toBe(20 * 1024 * 1024);
        }, 30000); // Timeout étendu pour gros fichier

        it('doit créer l\'arborescence de dossiers automatiquement', async () => {
            const testBuffer = Buffer.from('Arborescence test');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'local' as const
            };

            const metadata = {
                originalName: 'nested-file.txt',
                mimeType: 'text/plain',
                size: testBuffer.length
            };

            const context = {
                userId: 'new-user-xyz',
                workflowId: 'new-workflow-abc',
                agentInstanceId: 'new-instance-def'
            };

            const result = await mediaService.saveMedia(testBuffer, metadata, config, context);

            // Vérifier que les dossiers ont été créés
            const dirPath = path.dirname(path.join(TEST_STORAGE_ROOT, result.path!));
            const dirExists = await fs.access(dirPath).then(() => true).catch(() => false);
            expect(dirExists).toBe(true);
        });
    });

    // ============================================
    // CAS 3: Validation MIME types
    // ============================================

    describe('Cas 3: Validation des types MIME', () => {
        it('doit accepter les types MIME autorisés (images)', async () => {
            const testBuffer = Buffer.from('PNG content');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: 'test.png',
                mimeType: 'image/png',
                size: testBuffer.length
            };

            const context = {
                userId: 'user-1',
                workflowId: 'wf-1',
                agentInstanceId: 'inst-1'
            };

            const result = await mediaService.saveMedia(testBuffer, metadata, config, context);
            expect(result.mimeType).toBe('image/png');
        });

        it('doit rejeter les types MIME non autorisés', async () => {
            const testBuffer = Buffer.from('EXE content');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: 'malicious.exe',
                mimeType: 'application/x-msdownload', // Type non autorisé
                size: testBuffer.length
            };

            const context = {
                userId: 'user-1',
                workflowId: 'wf-1',
                agentInstanceId: 'inst-1'
            };

            await expect(
                mediaService.saveMedia(testBuffer, metadata, config, context)
            ).rejects.toThrow(MediaStorageError);
        });
    });

    // ============================================
    // CAS 4: Génération de checksum
    // ============================================

    describe('Cas 4: Checksum et intégrité', () => {
        it('doit générer un checksum SHA-256 cohérent', async () => {
            const testContent = 'Contenu identique pour vérification checksum';
            const testBuffer = Buffer.from(testContent);

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: 'checksum-test.txt',
                mimeType: 'text/plain',
                size: testBuffer.length
            };

            const context = {
                userId: 'user-ck',
                workflowId: 'wf-ck',
                agentInstanceId: 'inst-ck'
            };

            // Sauvegarder deux fois le même contenu
            const result1 = await mediaService.saveMedia(testBuffer, metadata, config, context);
            const result2 = await mediaService.saveMedia(testBuffer, metadata, config, context);

            // Les checksums doivent être identiques
            expect(result1.checksum).toBe(result2.checksum);
            expect(result1.checksum).toHaveLength(64); // SHA-256 = 64 caractères hex
        });

        it('doit générer des checksums différents pour contenus différents', async () => {
            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: 'test.txt',
                mimeType: 'text/plain',
                size: 10
            };

            const context = {
                userId: 'user-ck2',
                workflowId: 'wf-ck2',
                agentInstanceId: 'inst-ck2'
            };

            const result1 = await mediaService.saveMedia(
                Buffer.from('Contenu A'),
                { ...metadata, size: 9 },
                config,
                context
            );

            const result2 = await mediaService.saveMedia(
                Buffer.from('Contenu B'),
                { ...metadata, size: 9 },
                config,
                context
            );

            expect(result1.checksum).not.toBe(result2.checksum);
        });
    });

    // ============================================
    // CAS 5: Sanitization des noms de fichiers
    // ============================================

    describe('Cas 5: Sanitization noms de fichiers', () => {
        it('doit nettoyer les caractères spéciaux dans les noms', async () => {
            const testBuffer = Buffer.from('Test');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'db' as const
            };

            const metadata = {
                originalName: '../../../etc/passwd.png', // Tentative path traversal
                mimeType: 'image/png',
                size: testBuffer.length
            };

            const context = {
                userId: 'user-sec',
                workflowId: 'wf-sec',
                agentInstanceId: 'inst-sec'
            };

            const result = await mediaService.saveMedia(testBuffer, metadata, config, context);

            // Le nom doit être nettoyé
            expect(result.fileName).not.toContain('..');
            expect(result.fileName).not.toContain('/');
        });
    });

    // ============================================
    // CAS 6: Mode cloud (stub)
    // ============================================

    describe('Cas 6: Mode cloud', () => {
        it('doit uploader le media avec le profil cloud securise et retourner un payload exploitable par le catalogue', async () => {
            const testBuffer = Buffer.from('Cloud test');

            const config = {
                ...DEFAULT_PERSISTENCE_CONFIG,
                saveMedia: true,
                mediaStorage: 'cloud' as const,
                cloudConnectionProfileId: 'cloud-profile-1'
            };

            const metadata = {
                originalName: 'cloud file.png',
                mimeType: 'image/png',
                size: testBuffer.length,
                generatedBy: 'Cloud Agent',
                prompt: 'store in cloud'
            };

            const context = {
                userId: 'user-cloud',
                workflowId: 'wf-cloud',
                agentInstanceId: 'inst-cloud'
            };

            jest.spyOn(CloudConnectionProfile, 'findOne').mockImplementation(() => Promise.resolve({
                enabled: true,
                statusState: 'configured',
                toDecryptedCloudStorageConfig: () => ({
                    provider: 's3' as const,
                    s3: {
                        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                        secretAccessKey: 'super-secret-key',
                        bucketName: 'media-bucket',
                        region: 'eu-west-3',
                        keyPrefix: 'tenant/'
                    }
                })
            }) as any);
            jest.spyOn(S3StorageStrategy.prototype, 'initialize').mockResolvedValue(undefined);
            const uploadSpy = jest.spyOn(S3StorageStrategy.prototype, 'upload').mockImplementation(async (key) => ({
                success: true,
                key: `tenant/${key}`,
                etag: 'etag-cloud-1'
            }));

            const result = await mediaService.saveMedia(testBuffer, metadata, config, context);

            expect(result.storageMode).toBe('cloud');
            expect(result.fileName).toMatch(/^cloud_file-\d+-[a-f0-9]{8}\.png$/);
            expect(result.size).toBe(testBuffer.length);
            expect(result.checksum).toBeDefined();
            expect(result.metadata).toEqual(expect.objectContaining({
                generatedBy: 'Cloud Agent',
                prompt: 'store in cloud',
                cloudConnectionProfileId: 'cloud-profile-1',
                cloudProvider: 's3',
                cloudBucket: 'media-bucket',
                cloudKey: expect.stringMatching(/^tenant\/users\/user-cloud\/workflows\/wf-cloud\/agents\/inst-cloud\/\d{4}-\d{2}\/cloud_file-\d+-[a-f0-9]{8}\.png$/),
                etag: 'etag-cloud-1'
            }));
            expect(uploadSpy).toHaveBeenCalledWith(
                expect.stringMatching(/^users\/user-cloud\/workflows\/wf-cloud\/agents\/inst-cloud\/\d{4}-\d{2}\/cloud_file-\d+-[a-f0-9]{8}\.png$/),
                testBuffer,
                'image/png',
                expect.objectContaining({
                    originalName: 'cloud file.png',
                    generatedBy: 'Cloud Agent',
                    prompt: 'store in cloud',
                    workflowId: 'wf-cloud',
                    agentInstanceId: 'inst-cloud',
                    userId: 'user-cloud',
                    checksum: expect.any(String)
                })
            );
        });
    });
});
