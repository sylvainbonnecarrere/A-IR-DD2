/**
 * @fileoverview Service de stockage média flexible - Jalon 1
 * 
 * Gère le stockage des fichiers générés par les agents selon le mode configuré :
 * - database: Stockage inline MongoDB (< 16MB, pour petits fichiers)
 * - local: Stockage sur disque (volume Docker persistant)
 * - cloud: Stockage externe S3/GCS (future implémentation)
 * 
 * Arborescence Local:
 * storage/users/{userId}/workflows/{workflowId}/agents/{agentInstanceId}/{year}-{month}/{filename}
 * 
 * @see backend/src/types/persistence.ts
 * @see Guides/WIP/PLAN_CORRECTIF_PERSISTANCE_WORKFLOW.md
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
    MediaPayload,
    FileMetadata,
    PersistenceConfig,
    MAX_DATABASE_MEDIA_SIZE,
    ALLOWED_MIME_TYPES,
    MediaStorageMode
} from '../types/persistence';

// ============================================
// LOGGING CONDITIONNEL
// ============================================

const DEBUG = process.env.DEBUG_MEDIA_STORAGE === 'true' || process.env.NODE_ENV === 'development';
const debugLog = (message: string) => {
    if (DEBUG) console.log(message);
};

// ============================================
// CONFIGURATION
// ============================================

/**
 * Répertoire racine pour le stockage local
 * En Docker, ce chemin pointe vers un volume persistant
 */
const STORAGE_ROOT = process.env.MEDIA_STORAGE_PATH || path.join(process.cwd(), 'storage');

/**
 * Options de configuration du service
 */
export interface MediaStorageOptions {
    storageRoot?: string;
    createDirectories?: boolean;
    validateMimeTypes?: boolean;
    generateChecksums?: boolean;
}

const DEFAULT_OPTIONS: MediaStorageOptions = {
    storageRoot: STORAGE_ROOT,
    createDirectories: true,
    validateMimeTypes: true,
    generateChecksums: true
};

// ============================================
// TYPES D'ERREUR
// ============================================

export class MediaStorageError extends Error {
    constructor(
        message: string,
        public code: string,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'MediaStorageError';
    }
}

// ============================================
// SERVICE PRINCIPAL
// ============================================

export class MediaStorageService {
    private options: MediaStorageOptions;

    constructor(options: Partial<MediaStorageOptions> = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    private resolveStorageMode(config: PersistenceConfig & { mediaStorageMode?: 'database' | 'local' | 'cloud' }): 'db' | 'local' | 'cloud' {
        if (config.mediaStorage) {
            return config.mediaStorage;
        }

        switch (config.mediaStorageMode) {
            case 'database':
                return 'db';
            case 'local':
                return 'local';
            case 'cloud':
                return 'cloud';
            default:
                return 'db';
        }
    }

    // ============================================
    // MÉTHODE PRINCIPALE
    // ============================================

    /**
     * Sauvegarder un fichier média selon la configuration de persistance
     * 
     * @param file Buffer du fichier à sauvegarder
     * @param metadata Métadonnées du fichier
     * @param config Configuration de persistance de l'agent
     * @param context Contexte pour construction du chemin
     * @returns MediaPayload avec les infos de stockage
     */
    async saveMedia(
        file: Buffer,
        metadata: FileMetadata,
        config: PersistenceConfig & { mediaStorageMode?: 'database' | 'local' | 'cloud' },
        context: {
            userId: string;
            workflowId: string;
            agentInstanceId: string;
        }
    ): Promise<MediaPayload> {
        // Validation du MIME type si activée
        if (this.options.validateMimeTypes) {
            this.validateMimeType(metadata.mimeType);
        }

        // Génération checksum si activée
        const checksum = this.options.generateChecksums
            ? this.generateChecksum(file)
            : undefined;

        const storageMode = this.resolveStorageMode(config);

        // Routage selon le mode de stockage
        switch (storageMode) {
            case 'db':
                return this.saveToDatabase(file, metadata, checksum);
            
            case 'local':
                return this.saveToLocal(file, metadata, context, checksum);
            
            case 'cloud':
                return this.saveToCloud(file, metadata, context, checksum);
            
            default:
                throw new MediaStorageError(
                    `Mode de stockage non supporté: ${storageMode}`,
                    'INVALID_STORAGE_MODE'
                );
        }
    }

    // ============================================
    // STOCKAGE BASE DE DONNÉES
    // ============================================

    /**
     * Stocker le fichier inline dans le document MongoDB
     * Limité à 16MB (limite BSON)
     */
    private async saveToDatabase(
        file: Buffer,
        metadata: FileMetadata,
        checksum?: string
    ): Promise<MediaPayload> {
        // Vérification de la taille
        if (file.length > MAX_DATABASE_MEDIA_SIZE) {
            throw new MediaStorageError(
                `Fichier trop volumineux pour stockage en base: ${this.formatSize(file.length)} > ${this.formatSize(MAX_DATABASE_MEDIA_SIZE)}`,
                'FILE_TOO_LARGE',
                {
                    fileSize: file.length,
                    maxSize: MAX_DATABASE_MEDIA_SIZE,
                    recommendation: 'Utiliser le mode "local" ou "cloud" pour les fichiers > 16MB'
                }
            );
        }

        const fileName = this.sanitizeFileName(metadata.originalName);

        return {
            mimeType: metadata.mimeType,
            fileName,
            size: file.length,
            storageMode: 'database',
            data: file,
            checksum,
            metadata: {
                generatedBy: metadata.generatedBy,
                prompt: metadata.prompt,
                storedAt: new Date().toISOString()
            }
        };
    }

    // ============================================
    // STOCKAGE LOCAL (DISQUE)
    // ============================================

    /**
     * Stocker le fichier sur le disque serveur
     * Arborescence: storage/users/{userId}/workflows/{workflowId}/agents/{agentInstanceId}/{YYYY-MM}/{filename}
     */
    private async saveToLocal(
        file: Buffer,
        metadata: FileMetadata,
        context: {
            userId: string;
            workflowId: string;
            agentInstanceId: string;
        },
        checksum?: string
    ): Promise<MediaPayload> {
        // Construction du chemin
        const now = new Date();
        const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        const relativePath = path.join(
            'users',
            context.userId,
            'workflows',
            context.workflowId,
            'agents',
            context.agentInstanceId,
            yearMonth
        );
        
        const absoluteDir = path.join(this.options.storageRoot!, relativePath);
        
        // Création du répertoire si nécessaire
        if (this.options.createDirectories) {
            await fs.mkdir(absoluteDir, { recursive: true });
        }

        // Génération du nom de fichier unique
        const uniqueFileName = this.generateUniqueFileName(metadata.originalName);
        const absolutePath = path.join(absoluteDir, uniqueFileName);
        const relativeFilePath = path.join(relativePath, uniqueFileName);

        // Écriture du fichier
        try {
            await fs.writeFile(absolutePath, file);
            debugLog(`[MediaStorage] Fichier sauvegardé: ${relativeFilePath}`);
        } catch (error) {
            throw new MediaStorageError(
                `Erreur d'écriture du fichier: ${error instanceof Error ? error.message : 'Unknown'}`,
                'WRITE_ERROR',
                { path: absolutePath }
            );
        }

        return {
            mimeType: metadata.mimeType,
            fileName: uniqueFileName,
            size: file.length,
            storageMode: 'local',
            path: relativeFilePath.replace(/\\/g, '/'), // Normalisation des séparateurs
            checksum,
            metadata: {
                generatedBy: metadata.generatedBy,
                prompt: metadata.prompt,
                storedAt: new Date().toISOString()
            }
        };
    }

    // ============================================
    // STOCKAGE CLOUD (FUTURE IMPLÉMENTATION)
    // ============================================

    /**
     * Stocker le fichier dans un service cloud (S3, GCS, etc.)
     * TODO: Implémenter lors du Jalon Cloud
     */
    private async saveToCloud(
        _file: Buffer,
        metadata: FileMetadata,
        _context: {
            userId: string;
            workflowId: string;
            agentInstanceId: string;
        },
        checksum?: string
    ): Promise<MediaPayload> {
        // Placeholder pour implémentation future
        throw new MediaStorageError(
            'Le stockage cloud n\'est pas encore implémenté',
            'NOT_IMPLEMENTED',
            {
                recommendation: 'Utiliser le mode "local" en attendant',
                plannedVersion: '2.0'
            }
        );

        // Future implémentation:
        // 1. Upload vers S3/GCS avec SDK approprié
        // 2. Retourner l'URL publique ou présignée
        // return {
        //     mimeType: metadata.mimeType,
        //     fileName: metadata.originalName,
        //     size: file.length,
        //     storageMode: 'cloud',
        //     url: 'https://storage.example.com/...',
        //     checksum
        // };
    }

    // ============================================
    // RÉCUPÉRATION DE MÉDIA
    // ============================================

    /**
     * Valide un chemin relatif contre les attaques path-traversal
     * 
     * @param relativePath Chemin à valider
     * @param expectedUserId UserId attendu dans le chemin (optionnel)
     * @returns true si le chemin est sécurisé
     */
    validatePath(relativePath: string, expectedUserId?: string): boolean {
        // Normaliser le chemin
        const normalized = path.normalize(relativePath).replace(/\\/g, '/');
        
        // ⚠️ SÉCURITÉ: Bloquer les remontées de directory
        if (normalized.includes('..')) {
            debugLog(`[MediaStorage] Path-traversal attempt blocked: ${relativePath}`);
            return false;
        }
        
        // ⚠️ SÉCURITÉ: Bloquer les chemins absolus
        if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
            debugLog(`[MediaStorage] Absolute path blocked: ${relativePath}`);
            return false;
        }
        
        // Vérifier la structure attendue: users/{userId}/...
        const parts = normalized.split('/');
        if (parts.length < 2 || parts[0] !== 'users') {
            debugLog(`[MediaStorage] Invalid path structure: ${relativePath}`);
            return false;
        }
        
        // Si un userId est fourni, vérifier qu'il correspond
        if (expectedUserId && parts[1] !== expectedUserId) {
            debugLog(`[MediaStorage] UserId mismatch: expected ${expectedUserId}, got ${parts[1]}`);
            return false;
        }
        
        return true;
    }

    /**
     * Récupérer un fichier stocké localement avec validation de sécurité
     * 
     * ⚠️ SÉCURITÉ: Valide le chemin contre path-traversal avant lecture
     * 
     * @param relativePath Chemin relatif du fichier
     * @param expectedUserId UserId attendu pour validation (recommandé)
     * @returns Buffer contenant le fichier
     */
    async getLocalMedia(relativePath: string, expectedUserId?: string): Promise<Buffer> {
        // ⚠️ SÉCURITÉ CRITIQUE: Valider le chemin AVANT toute opération
        if (!this.validatePath(relativePath, expectedUserId)) {
            throw new MediaStorageError(
                'Chemin de fichier invalide ou non autorisé',
                'PATH_TRAVERSAL_BLOCKED',
                { path: relativePath.substring(0, 50) + '...' } // Tronquer pour sécurité logs
            );
        }
        
        const absolutePath = path.join(this.options.storageRoot!, relativePath);
        
        try {
            const exists = await this.fileExists(absolutePath);
            if (!exists) {
                throw new MediaStorageError(
                    `Fichier introuvable: ${relativePath}`,
                    'FILE_NOT_FOUND',
                    { path: relativePath }
                );
            }
            
            return await fs.readFile(absolutePath);
        } catch (error) {
            if (error instanceof MediaStorageError) throw error;
            throw new MediaStorageError(
                `Erreur de lecture: ${error instanceof Error ? error.message : 'Unknown'}`,
                'READ_ERROR',
                { path: relativePath }
            );
        }
    }

    /**
     * Obtenir les stats d'un fichier local pour streaming
     * 
     * @param relativePath Chemin relatif du fichier
     * @param expectedUserId UserId pour validation
     * @returns Stats du fichier (taille, mtime, etc.)
     */
    async getLocalMediaStats(relativePath: string, expectedUserId?: string): Promise<{
        size: number;
        mtime: Date;
        absolutePath: string;
    }> {
        if (!this.validatePath(relativePath, expectedUserId)) {
            throw new MediaStorageError(
                'Chemin de fichier invalide',
                'PATH_TRAVERSAL_BLOCKED'
            );
        }
        
        const absolutePath = path.join(this.options.storageRoot!, relativePath);
        const stats = await fs.stat(absolutePath);
        
        return {
            size: stats.size,
            mtime: stats.mtime,
            absolutePath
        };
    }

    /**
     * Vérifier si un fichier existe
     */
    async fileExists(absolutePath: string): Promise<boolean> {
        try {
            await fs.access(absolutePath);
            return true;
        } catch {
            return false;
        }
    }

    // ============================================
    // SUPPRESSION DE MÉDIA
    // ============================================

    /**
     * Supprimer un fichier stocké localement
     */
    async deleteLocalMedia(relativePath: string): Promise<boolean> {
        const absolutePath = path.join(this.options.storageRoot!, relativePath);
        
        try {
            await fs.unlink(absolutePath);
            debugLog(`[MediaStorage] Fichier supprimé: ${relativePath}`);
            return true;
        } catch (error) {
            console.warn(`[MediaStorage] Échec suppression ${relativePath}:`, error);
            return false;
        }
    }

    /**
     * Supprimer tous les médias d'un agent
     */
    async deleteAgentMedia(
        userId: string,
        workflowId: string,
        agentInstanceId: string
    ): Promise<number> {
        const agentDir = path.join(
            this.options.storageRoot!,
            'users',
            userId,
            'workflows',
            workflowId,
            'agents',
            agentInstanceId
        );

        try {
            const exists = await this.fileExists(agentDir);
            if (!exists) return 0;

            const deletedCount = await this.deleteDirectoryRecursive(agentDir);
            debugLog(`[MediaStorage] Dossier agent supprimé: ${agentDir} (${deletedCount} fichiers)`);
            return deletedCount;
        } catch (error) {
            console.error(`[MediaStorage] Erreur suppression dossier agent:`, error);
            return 0;
        }
    }

    /**
     * Supprimer tous les médias d'un workflow
     */
    async deleteWorkflowMedia(userId: string, workflowId: string): Promise<number> {
        const workflowDir = path.join(
            this.options.storageRoot!,
            'users',
            userId,
            'workflows',
            workflowId
        );

        try {
            const exists = await this.fileExists(workflowDir);
            if (!exists) return 0;

            const deletedCount = await this.deleteDirectoryRecursive(workflowDir);
            debugLog(`[MediaStorage] Dossier workflow supprimé: ${workflowDir} (${deletedCount} fichiers)`);
            return deletedCount;
        } catch (error) {
            console.error(`[MediaStorage] Erreur suppression dossier workflow:`, error);
            return 0;
        }
    }

    // ============================================
    // UTILITAIRES PRIVÉS
    // ============================================

    /**
     * Valider le MIME type contre la whitelist
     */
    private validateMimeType(mimeType: string): void {
        if (!ALLOWED_MIME_TYPES.includes(mimeType as typeof ALLOWED_MIME_TYPES[number])) {
            throw new MediaStorageError(
                `MIME type non autorisé: ${mimeType}`,
                'INVALID_MIME_TYPE',
                {
                    received: mimeType,
                    allowed: ALLOWED_MIME_TYPES
                }
            );
        }
    }

    /**
     * Générer un checksum SHA-256
     */
    private generateChecksum(data: Buffer): string {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Générer un nom de fichier unique
     */
    private generateUniqueFileName(originalName: string): string {
        const ext = path.extname(originalName);
        const base = path.basename(originalName, ext);
        const sanitized = this.sanitizeFileName(base);
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        
        return `${sanitized}-${timestamp}-${random}${ext}`;
    }

    /**
     * Nettoyer un nom de fichier
     */
    private sanitizeFileName(fileName: string): string {
        const sanitized = fileName
            .replace(/[\\/]+/g, '_')
            .replace(/\.{2,}/g, '_')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^\.+/, '')
            .substring(0, 100);

        return sanitized || 'file';
    }

    /**
     * Formater une taille de fichier pour affichage
     */
    private formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    /**
     * Supprimer un répertoire récursivement
     */
    private async deleteDirectoryRecursive(dirPath: string): Promise<number> {
        let count = 0;
        
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    count += await this.deleteDirectoryRecursive(fullPath);
                } else {
                    await fs.unlink(fullPath);
                    count++;
                }
            }
            
            await fs.rmdir(dirPath);
            return count;
        } catch (error) {
            console.warn(`[MediaStorage] Erreur suppression ${dirPath}:`, error);
            return count;
        }
    }

    // ============================================
    // MÉTHODES UTILITAIRES PUBLIQUES
    // ============================================

    /**
     * Obtenir les statistiques de stockage d'un utilisateur
     */
    async getUserStorageStats(userId: string): Promise<{
        totalFiles: number;
        totalSize: number;
        byWorkflow: Record<string, { files: number; size: number }>;
    }> {
        const userDir = path.join(this.options.storageRoot!, 'users', userId);
        
        try {
            const exists = await this.fileExists(userDir);
            if (!exists) {
                return { totalFiles: 0, totalSize: 0, byWorkflow: {} };
            }

            const stats = { totalFiles: 0, totalSize: 0, byWorkflow: {} as Record<string, { files: number; size: number }> };
            
            const workflowsDir = path.join(userDir, 'workflows');
            const workflowsExist = await this.fileExists(workflowsDir);
            if (!workflowsExist) {
                return stats;
            }

            const workflows = await fs.readdir(workflowsDir);
            
            for (const workflowId of workflows) {
                const workflowStats = await this.getDirectoryStats(
                    path.join(workflowsDir, workflowId)
                );
                stats.byWorkflow[workflowId] = workflowStats;
                stats.totalFiles += workflowStats.files;
                stats.totalSize += workflowStats.size;
            }
            
            return stats;
        } catch (error) {
            console.error(`[MediaStorage] Erreur stats utilisateur:`, error);
            return { totalFiles: 0, totalSize: 0, byWorkflow: {} };
        }
    }

    /**
     * Calculer les stats d'un répertoire
     */
    private async getDirectoryStats(
        dirPath: string
    ): Promise<{ files: number; size: number }> {
        let files = 0;
        let size = 0;
        
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    const subStats = await this.getDirectoryStats(fullPath);
                    files += subStats.files;
                    size += subStats.size;
                } else {
                    const stat = await fs.stat(fullPath);
                    files++;
                    size += stat.size;
                }
            }
        } catch {
            // Ignorer les erreurs silencieusement
        }
        
        return { files, size };
    }
}

// ============================================
// INSTANCE SINGLETON
// ============================================

let instance: MediaStorageService | null = null;

/**
 * Obtenir l'instance singleton du service
 */
export function getMediaStorageService(
    options?: Partial<MediaStorageOptions>
): MediaStorageService {
    if (!instance || options) {
        instance = new MediaStorageService(options);
    }
    return instance;
}

/**
 * Réinitialiser le singleton (pour tests)
 */
export function resetMediaStorageService(): void {
    instance = null;
}
