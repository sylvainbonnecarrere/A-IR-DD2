import crypto from 'crypto';

/**
 * Encryption utility using AES-256-GCM with PBKDF2 key derivation
 * 
 * Format stocké: "iv:salt:authTag:encryptedData"
 * - iv: Initialization Vector (16 bytes hex)
 * - salt: Salt pour PBKDF2 (32 bytes hex)
 * - authTag: Authentication tag GCM (16 bytes hex)
 * - encryptedData: Données chiffrées (hex)
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const TAG_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000; // Résistance brute-force

/**
 * Dérive une clé de chiffrement à partir de la clé maître et d'un salt
 * @param masterKey Clé maître depuis process.env.ENCRYPTION_KEY
 * @param salt Salt unique pour chaque encryption
 * @param userSalt Salt additionnel basé sur userId
 */
function deriveKey(masterKey: string, salt: Buffer, userSalt: string): Buffer {
    const combinedSalt = Buffer.concat([salt, Buffer.from(userSalt, 'utf-8')]);
    return crypto.pbkdf2Sync(
        Buffer.from(masterKey, 'hex'),
        combinedSalt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        'sha256'
    );
}

/**
 * Chiffre une chaîne avec AES-256-GCM
 * @param plaintext Texte en clair (API key)
 * @param userSalt Salt unique par utilisateur (userId)
 * @returns Format "iv:salt:authTag:encryptedData"
 */
export function encrypt(plaintext: string, userSalt: string): string {
    if (!process.env.ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY non configurée dans .env');
    }

    // Générer IV et salt uniques
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);

    // Dériver clé
    const key = deriveKey(process.env.ENCRYPTION_KEY, salt, userSalt);

    // Chiffrer
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    // Récupérer auth tag
    const authTag = cipher.getAuthTag();

    // Format final
    return [
        iv.toString('hex'),
        salt.toString('hex'),
        authTag.toString('hex'),
        encrypted
    ].join(':');
}

/**
 * Déchiffre une chaîne chiffrée avec AES-256-GCM
 * @param ciphertext Format "iv:salt:authTag:encryptedData" OU plaintext (legacy)
 * @param userSalt Salt unique par utilisateur (userId)
 * @returns Texte en clair (API key)
 */
export function decrypt(ciphertext: string, userSalt: string): string {
    if (!process.env.ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY non configurée dans .env');
    }

    // ⭐ FIX: Vérifier si c'est du plaintext non chiffré (migration legacy)
    // Si le format n'est pas "iv:salt:authTag:data", retourner directement
    if (!isEncrypted(ciphertext)) {
        console.warn('[decrypt] ⚠️ Legacy plaintext API key detected (not encrypted), returning as-is');
        return ciphertext; // ← Retourner plaintext pour backward compatibility
    }

    // Parser format
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
        throw new Error('Format de ciphertext invalide');
    }

    const [ivHex, saltHex, authTagHex, encryptedData] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const salt = Buffer.from(saltHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    // Dériver clé (même processus qu'encryption)
    const key = deriveKey(process.env.ENCRYPTION_KEY, salt, userSalt);

    // Déchiffrer
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
}

/**
 * Vérifie si une chaîne est chiffrée (format valide)
 */
export function isEncrypted(value: string): boolean {
    const parts = value.split(':');
    return parts.length === 4 && parts.every(part => /^[0-9a-f]+$/i.test(part));
}
