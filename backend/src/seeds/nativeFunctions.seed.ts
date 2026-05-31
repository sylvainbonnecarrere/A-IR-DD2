/**
 * Seed — 11 Fonctions Natives Phil (Tools V2)
 *
 * Ces fonctions sont `origin: 'native'`, `isReadonly: true`, `userId: null`.
 * Elles sont disponibles pour tous les utilisateurs et tous les workflows.
 *
 * Source de vérité : plan-fonctions-personnalisees-partie2.md
 * NB: bash_py est isEnabled: false par mesure de sécurité (docker requis).
 */

type NativeFunctionLanguage = 'python' | 'typescript';
type NativeFunctionOrigin = 'native';

interface NativeFunctionSeed {
    name: string;
    description: string;
    language: NativeFunctionLanguage;
    origin: NativeFunctionOrigin;
    userId: null;
    workflowId: null;
    inputSchema: object;
    outputSchema: object;
    codePath: string;
    codeInline: null;
    dependencies: string[];
    isEnabled: boolean;
    isReadonly: boolean;
    version: number;
    tags: string[];
    healthCheck?: {
        criticalPythonImports?: Array<string | {
            module: string;
            dependency?: string;
        }>;
    };
}

export const nativeFunctionsSeed: NativeFunctionSeed[] = [
    // ─────────────────────────────────────────────────────────────────
    // 1. agent_py — Délégation à un sous-agent LLM
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'agent_py',
        description: "Délègue une tâche à un sous-agent LLM. Utile pour orchestrer des agents spécialisés ou décomposer une tâche complexe en sous-tâches avec retour du résultat.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['task', 'agent_name'],
            properties: {
                task: { type: 'string', description: "Description de la tâche à déléguer au sous-agent" },
                agent_name: { type: 'string', description: "Nom de l'agent cible (doit exister dans le registre)" },
                context: { type: 'string', description: "Contexte supplémentaire à fournir au sous-agent (optionnel)" },
                max_iterations: { type: 'number', default: 5, description: "Nombre max d'itérations pour le sous-agent" }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                result: { type: 'string', description: "Résultat retourné par le sous-agent" },
                iterations_used: { type: 'number' },
                agent_name: { type: 'string' }
            }
        },
        codePath: 'backend/python/native/agent_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['agent', 'orchestration', 'delegation']
    },

    // ─────────────────────────────────────────────────────────────────
    // 2. bash_py — Exécution de commandes shell (DÉSACTIVÉ par défaut)
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'bash_py',
        description: "Exécute des commandes shell dans un environnement Docker sandboxé sécurisé. DÉSACTIVÉ par défaut — nécessite une activation explicite par l'administrateur.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['command'],
            properties: {
                command: { type: 'string', description: "Commande shell à exécuter" },
                cwd: { type: 'string', description: "Répertoire de travail (sandbox)", default: '/sandbox/workspace' },
                timeout: { type: 'number', default: 10, description: "Timeout en secondes (max: 30)" },
                env: { type: 'object', description: "Variables d'environnement supplémentaires" }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                stdout: { type: 'string' },
                stderr: { type: 'string' },
                exit_code: { type: 'number' },
                timed_out: { type: 'boolean' }
            }
        },
        codePath: 'backend/python/native/bash_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: false, // SÉCURITÉ: désactivé par défaut
        isReadonly: true,
        version: 1,
        tags: ['shell', 'bash', 'system', 'sandbox', 'dangerous']
    },

    // ─────────────────────────────────────────────────────────────────
    // 3. edit_py — Modification ciblée d'un fichier (recherche/remplacement)
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'edit_py',
        description: "Effectue une modification ciblée dans un fichier en remplaçant une chaîne de texte exacte. Opère dans le workspace persistant de l'utilisateur.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['file_path', 'old_str', 'new_str'],
            properties: {
                file_path: { type: 'string', description: "Chemin du fichier relatif au workspace persistant" },
                old_str: { type: 'string', description: "Chaîne exacte à remplacer (doit être unique dans le fichier)" },
                new_str: { type: 'string', description: "Nouveau contenu de remplacement" }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                file_path: { type: 'string' },
                occurrences_replaced: { type: 'number' },
                message: { type: 'string' }
            }
        },
        codePath: 'backend/python/native/edit_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['file', 'edit', 'write', 'workspace']
    },

    // ─────────────────────────────────────────────────────────────────
    // 4. ls_py — Listing du contenu d'un répertoire
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'ls_py',
        description: "Liste le contenu d'un répertoire dans le workspace persistant. Retourne les fichiers et dossiers avec leurs métadonnées.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['directory_path'],
            properties: {
                directory_path: { type: 'string', description: "Chemin du répertoire relatif au workspace persistant" },
                recursive: { type: 'boolean', default: false, description: "Lister récursivement les sous-dossiers" },
                show_hidden: { type: 'boolean', default: false, description: "Inclure les fichiers cachés (commençant par .)" },
                filter_pattern: { type: 'string', description: "Pattern glob pour filtrer les résultats (ex: '*.py')" }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            type: { type: 'string', enum: ['file', 'directory'] },
                            size: { type: 'number' },
                            modified_at: { type: 'string' }
                        }
                    }
                },
                total_files: { type: 'number' },
                total_dirs: { type: 'number' }
            }
        },
        codePath: 'backend/python/native/ls_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['file', 'directory', 'list', 'workspace']
    },

    // ─────────────────────────────────────────────────────────────────
    // 5. multi_edit_py — Modifications multiples en batch sur un fichier
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'multi_edit_py',
        description: "Applique plusieurs remplacements de texte sur un fichier en une seule opération atomique. Idéal pour des refactorisations ou migrations de code.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['file_path', 'edits'],
            properties: {
                file_path: { type: 'string', description: "Chemin du fichier relatif au workspace persistant" },
                edits: {
                    type: 'array',
                    description: "Liste ordonnée des remplacements à appliquer",
                    items: {
                        type: 'object',
                        required: ['old_str', 'new_str'],
                        properties: {
                            old_str: { type: 'string' },
                            new_str: { type: 'string' }
                        }
                    }
                }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                applied_edits: { type: 'number' },
                failed_edits: { type: 'number' },
                errors: { type: 'array', items: { type: 'string' } }
            }
        },
        codePath: 'backend/python/native/multi_edit_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['file', 'edit', 'batch', 'workspace']
    },

    // ─────────────────────────────────────────────────────────────────
    // 6. read_py — Lecture du contenu d'un fichier
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'read_py',
        description: "Lit et retourne le contenu d'un fichier dans le workspace persistant. Supporte la lecture partielle par plage de lignes.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['file_path'],
            properties: {
                file_path: { type: 'string', description: "Chemin du fichier relatif au workspace persistant" },
                start_line: { type: 'number', description: "Ligne de début (1-indexé, optionnel)" },
                end_line: { type: 'number', description: "Ligne de fin inclusive (optionnel)" },
                encoding: { type: 'string', default: 'utf-8', description: "Encodage du fichier" }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: "Contenu du fichier" },
                file_path: { type: 'string' },
                total_lines: { type: 'number' },
                lines_returned: { type: 'number' }
            }
        },
        codePath: 'backend/python/native/read_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['file', 'read', 'workspace']
    },

    // ─────────────────────────────────────────────────────────────────
    // 7. todo_read_py — Lecture de la liste TODO
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'todo_read_py',
        description: "Lit la liste des tâches TODO associées à la session ou au workflow courant.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            properties: {
                filter_status: {
                    type: 'string',
                    enum: ['all', 'pending', 'in_progress', 'completed'],
                    default: 'all',
                    description: "Filtrer par statut"
                },
                filter_priority: {
                    type: 'string',
                    enum: ['all', 'high', 'medium', 'low'],
                    default: 'all'
                }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            content: { type: 'string' },
                            status: { type: 'string' },
                            priority: { type: 'string' },
                            created_at: { type: 'string' }
                        }
                    }
                },
                total: { type: 'number' }
            }
        },
        codePath: 'backend/python/native/todo_read_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['todo', 'tasks', 'planning']
    },

    // ─────────────────────────────────────────────────────────────────
    // 8. todo_write_py — Écriture/modification de la liste TODO
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'todo_write_py',
        description: "Crée, met à jour ou supprime des tâches TODO dans la liste associée à la session ou au workflow courant.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['action'],
            properties: {
                action: {
                    type: 'string',
                    enum: ['create', 'update', 'delete', 'clear_completed'],
                    description: "Action à effectuer"
                },
                todo: {
                    type: 'object',
                    description: "Données de la tâche (requis pour create/update)",
                    properties: {
                        id: { type: 'string', description: "Requis pour update/delete" },
                        content: { type: 'string', description: "Contenu de la tâche (requis pour create)" },
                        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                        priority: { type: 'string', enum: ['high', 'medium', 'low'], default: 'medium' }
                    }
                }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                action: { type: 'string' },
                todo_id: { type: 'string' },
                message: { type: 'string' }
            }
        },
        codePath: 'backend/python/native/todo_write_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['todo', 'tasks', 'planning', 'write']
    },

    // ─────────────────────────────────────────────────────────────────
    // 9. web_fetch_py — Récupération de contenu web
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'web_fetch_py',
        description: "Récupère le contenu d'une URL et le retourne sous forme de texte brut ou HTML parsé. Respecte les politiques robots.txt.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['url'],
            properties: {
                url: { type: 'string', format: 'uri', description: "URL à récupérer (https uniquement)" },
                extract_text: { type: 'boolean', default: true, description: "Extraire le texte brut de la page HTML" },
                timeout: { type: 'number', default: 10, description: "Timeout en secondes" },
                headers: { type: 'object', description: "En-têtes HTTP supplémentaires" },
                max_content_length: { type: 'number', default: 50000, description: "Longueur max du contenu retourné (caractères)" }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string' },
                status_code: { type: 'number' },
                url: { type: 'string' },
                title: { type: 'string' },
                content_type: { type: 'string' },
                truncated: { type: 'boolean' }
            }
        },
        codePath: 'backend/python/native/web_fetch_py.py',
        codeInline: null,
        dependencies: ['beautifulsoup4', 'requests', 'lxml'],
        healthCheck: {
            criticalPythonImports: [
                'requests',
                {
                    module: 'bs4',
                    dependency: 'beautifulsoup4'
                },
                'lxml'
            ]
        },
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['web', 'fetch', 'http', 'scraping']
    },

    // ─────────────────────────────────────────────────────────────────
    // 10. web_search_py — Recherche sur le web
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'web_search_py',
        description: "Fonction web search en cours de réimplémentation. Retourne actuellement un message temporaire de disponibilité pendant le nettoyage du runtime.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['query'],
            properties: {
                query: { type: 'string', description: "Requête de recherche" },
                num_results: { type: 'number', default: 5, minimum: 1, maximum: 20 },
                language: { type: 'string', default: 'fr', description: "Langue des résultats (code ISO 639-1)" },
                safe_search: { type: 'boolean', default: true }
            }
        },
        outputSchema: {
            type: 'string',
            description: "Message temporaire tant que la fonctionnalité n'est pas réimplémentée."
        },
        codePath: 'backend/python/native/web_search_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['web', 'search', 'internet', 'research']
    },

    // ─────────────────────────────────────────────────────────────────
    // 11. write_py — Création/écriture d'un fichier
    // ─────────────────────────────────────────────────────────────────
    {
        name: 'write_py',
        description: "Crée ou écrase un fichier dans le workspace persistant avec le contenu fourni. Crée les répertoires parents si nécessaire.",
        language: 'python',
        origin: 'native',
        userId: null,
        workflowId: null,
        inputSchema: {
            type: 'object',
            required: ['file_path', 'content'],
            properties: {
                file_path: { type: 'string', description: "Chemin du fichier relatif au workspace persistant" },
                content: { type: 'string', description: "Contenu du fichier" },
                encoding: { type: 'string', default: 'utf-8' },
                overwrite: { type: 'boolean', default: true, description: "Permet d'écraser un fichier existant" },
                create_dirs: { type: 'boolean', default: true, description: "Créer les répertoires parents si manquants" }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                file_path: { type: 'string' },
                bytes_written: { type: 'number' },
                created: { type: 'boolean', description: "true si nouveau fichier, false si écrasement" }
            }
        },
        codePath: 'backend/python/native/write_py.py',
        codeInline: null,
        dependencies: [],
        isEnabled: true,
        isReadonly: true,
        version: 1,
        tags: ['file', 'write', 'create', 'workspace']
    }
];
