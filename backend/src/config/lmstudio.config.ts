// Configuration sécurisée pour le proxy LMStudio
export const LMSTUDIO_CONFIG = {
    // Endpoints testés pour l'auto-détection.
    // La politique runtime réelle est centralisée dans utils/localEndpointPolicy.ts.
    DISCOVERY_ENDPOINTS: [
        'http://localhost:1234',      // LM Studio default
        'http://localhost:3928',      // Jan default
        'http://127.0.0.1:1234',
        'http://127.0.0.1:3928',
        'http://localhost:11434',     // Ollama default
        'http://127.0.0.1:11434'
    ] as string[],

    // Timeout sécurisé pour éviter les requêtes bloquées
    TIMEOUT_MS: 120000,

    // Timeout pour chat/completions non-streaming (réponses complètes locales lentes)
    CHAT_COMPLETION_TIMEOUT_MS: 600000,

    // Timeout du premier octet pour le streaming local.
    // Les LLM locaux peuvent prendre plusieurs minutes avant d'émettre le premier token.
    STREAM_FIRST_BYTE_TIMEOUT_MS: 600000,

    // Rate limiting - Protection DoS
    MAX_REQUESTS_PER_MINUTE: 60,

    // Taille max requête - Protection DoS
    MAX_REQUEST_SIZE: '10mb',

    // Cache TTL pour les modèles
    MODELS_CACHE_TTL_MS: 600000, // 10 minutes

    // Retry logic pour requêtes échouées
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,

    // Timeout spécifique pour détection (plus court)
    DETECTION_TIMEOUT_MS: 5000
};