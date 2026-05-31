import type { FunctionRunRecord, SandboxRunResult } from '../types/function.types';

type DiagnosticSeverity = 'success' | 'info' | 'warning' | 'error';

type ToolDiagnosticSource = {
    code?: string;
    subsystem?: string;
    failureKind?: string;
    message?: string;
    retryable?: boolean;
};

export interface QaDiagnosticPresentation {
    label: string;
    subsystemLabel: string;
    recommendedAction: string;
    severity: DiagnosticSeverity;
    rawCode?: string;
    rawFailureKind?: string;
}

const STATUS_LABELS: Record<FunctionRunRecord['status'], string> = {
    queued: 'En attente d execution',
    running: 'Execution en cours',
    completed: 'Execution validee',
    failed: 'Echec d execution',
    stopped: 'Execution arretee',
    timed_out: 'Execution expiree'
};

const SUBSYSTEM_LABELS: Record<string, string> = {
    validation: 'validation des entrees',
    build_preparation: 'preparation securisee',
    runtime_readiness: 'readiness runtime',
    runner: 'runner sandbox',
    wrapper: 'wrapper d execution',
    user_code: 'code utilisateur',
    dependency: 'dependances runtime',
    sandbox_runtime: 'execution sandbox',
    unknown: 'sous-systeme inconnu'
};

const DIAGNOSTIC_MAP: Record<string, Pick<QaDiagnosticPresentation, 'label' | 'recommendedAction' | 'severity'>> = {
    JSON_INVALID: {
        label: 'JSON de test invalide',
        recommendedAction: 'Corriger le JSON strict avec des doubles quotes puis relancer le test.',
        severity: 'error'
    },
    SANDBOX_TARGET_NOT_FOUND: {
        label: 'Fonction cible introuvable',
        recommendedAction: 'Verifier la fonction selectionnee et recharger la bibliotheque avant de relancer.',
        severity: 'error'
    },
    SANDBOX_TARGET_DISABLED: {
        label: 'Fonction desactivee',
        recommendedAction: 'Reactiver la fonction dans la bibliotheque ou choisir un autre outil.',
        severity: 'warning'
    },
    BUILD_PREPARATION_ERROR: {
        label: 'Preparation securisee absente',
        recommendedAction: 'Verifier le statut de build ou de provisionnement avant toute nouvelle execution.',
        severity: 'warning'
    },
    PLATFORM_PROVISION_REQUIRED: {
        label: 'Provisionnement plateforme requis',
        recommendedAction: 'Demander ou attendre le provisionnement plateforme au lieu de relancer en boucle.',
        severity: 'warning'
    },
    RUNTIME_NOT_READY: {
        label: 'Runtime non pret',
        recommendedAction: 'Attendre que le runtime soit de nouveau pret puis relancer l execution.',
        severity: 'warning'
    },
    TIMEOUT: {
        label: 'Execution expiree',
        recommendedAction: 'Reduire la charge de la fonction ou revoir le timeout si le contrat le permet.',
        severity: 'warning'
    },
    DEPENDENCY_MISSING: {
        label: 'Dependance runtime manquante',
        recommendedAction: 'Verifier l image runtime ou le provisionnement plateforme des dependances requises.',
        severity: 'error'
    },
    USER_CODE_SYNTAX_ERROR: {
        label: 'Syntaxe du code utilisateur invalide',
        recommendedAction: 'Corriger le code source puis relancer une verification ou un test manuel.',
        severity: 'error'
    },
    WRAPPER_SYNTAX_ERROR: {
        label: 'Erreur interne de wrapper sandbox',
        recommendedAction: 'Escalader cote developpement avec le code d erreur et l executionId.',
        severity: 'error'
    },
    SANDBOX_RUNTIME_ERROR: {
        label: 'Erreur d execution sandbox',
        recommendedAction: 'Relire le message d erreur, verifier les acces et consulter les runs persistés.',
        severity: 'error'
    },
    ORCHESTRATOR_ERROR: {
        label: 'Erreur d orchestration',
        recommendedAction: 'Consulter les logs backend et l executionId avant nouvelle tentative.',
        severity: 'error'
    }
};

function normalizeDiagnosticKey(input?: string): string | undefined {
    return input?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function fallbackDiagnostic(source?: ToolDiagnosticSource | null): Pick<QaDiagnosticPresentation, 'label' | 'recommendedAction' | 'severity'> {
    switch (source?.subsystem) {
        case 'validation':
            return {
                label: 'Erreur de validation',
                recommendedAction: 'Corriger les entrees fournies puis relancer le test.',
                severity: 'error'
            };
        case 'build_preparation':
            return {
                label: 'Preparation securisee incomplete',
                recommendedAction: 'Verifier le build ou le provisionnement avant execution.',
                severity: 'warning'
            };
        case 'runtime_readiness':
            return {
                label: 'Runtime indisponible',
                recommendedAction: 'Attendre le retour du runtime avant de relancer.',
                severity: 'warning'
            };
        case 'dependency':
            return {
                label: 'Probleme de dependances runtime',
                recommendedAction: 'Verifier les dependances critiques declarees dans l image runtime.',
                severity: 'error'
            };
        case 'user_code':
            return {
                label: 'Probleme dans le code utilisateur',
                recommendedAction: 'Corriger le code puis relancer une execution manuelle.',
                severity: 'error'
            };
        case 'wrapper':
            return {
                label: 'Probleme interne de wrapper',
                recommendedAction: 'Escalader cote developpement avec les details de l execution.',
                severity: 'error'
            };
        default:
            return {
                label: 'Diagnostic a confirmer',
                recommendedAction: 'Consulter le code d erreur, le sous-systeme et les runs persistés.',
                severity: source?.retryable ? 'warning' : 'error'
            };
    }
}

export function getRunStatusLabel(status: FunctionRunRecord['status']): string {
    return STATUS_LABELS[status] ?? status;
}

export function getRunStatusFilterLabel(status: 'all' | FunctionRunRecord['status']): string {
    return status === 'all' ? 'Tous les runs QA' : getRunStatusLabel(status);
}

export function getQaDiagnosticPresentation(source?: ToolDiagnosticSource | null): QaDiagnosticPresentation {
    const codeKey = normalizeDiagnosticKey(source?.code);
    const failureKey = normalizeDiagnosticKey(source?.failureKind);
    const base = (codeKey && DIAGNOSTIC_MAP[codeKey])
        || (failureKey && DIAGNOSTIC_MAP[failureKey])
        || fallbackDiagnostic(source);

    return {
        ...base,
        subsystemLabel: SUBSYSTEM_LABELS[source?.subsystem ?? 'unknown'] ?? 'sous-systeme inconnu',
        rawCode: source?.code,
        rawFailureKind: source?.failureKind,
    };
}

export function formatQaDiagnosticMessage(source?: ToolDiagnosticSource | null, fallbackMessage?: string): string {
    const diagnostic = getQaDiagnosticPresentation(source);
    const lines = [
        `Diagnostic QA: ${diagnostic.label}`,
        `Sous-systeme: ${diagnostic.subsystemLabel}`,
        `Action recommandee: ${diagnostic.recommendedAction}`
    ];

    const message = source?.message || fallbackMessage;
    if (message) {
        lines.unshift(message);
    }

    return lines.join('\n');
}

export function getSandboxResultDiagnostic(result: SandboxRunResult | null): QaDiagnosticPresentation | null {
    if (!result?.errorDetails) {
        return null;
    }

    return getQaDiagnosticPresentation(result.errorDetails);
}