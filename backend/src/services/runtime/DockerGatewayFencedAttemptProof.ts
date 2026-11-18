import { DockerAttemptReservation } from './DockerAttemptReservation';

import { SpawnDockerProcessRunner, type DockerProcessRunner } from './DockerSandboxRunner';

import { createDockerProcessRunner } from './DockerGatewayRuntime';

import type { DockerGatewayAdmissionPort } from './DockerGatewayAdmission';

import { MongoDockerGatewayAdmission } from './MongoDockerGatewayAdmission';

import type { DockerGatewayControlClient } from './DockerGatewayControlClient';

const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;

const ATTEMPT_LABEL = 'airdd2.execution.attempt';

const FENCE_LABEL = 'airdd2.fence.op';

const TERMINAL_STATES = ['created', 'exited', 'dead'] as const;

const CONTAINER_STATES = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'] as const;

const INSPECT_TIMEOUT_MS = 5_000;

export type DockerAttemptQuiescentState = 'absent' | typeof TERMINAL_STATES[number];

export interface DockerAttemptFencingProof {
    operationId: string;
    quiescent: boolean;
    containerState: DockerAttemptQuiescentState | null;
}

/**
 * Preuve de quiescence d'une tentative supervisée, appuyée sur le fencing gateway
 * (US-J7-05) : l'opération fencée correspondante est re-fencée puis vérifiée via le
 * control plane (`/v1/operations/:id/fence` puis `/verify` : label/ID + réservation
 * de nom + fenêtre de grâce, fail-closed, borne 30 s). Toute erreur ou absence de
 * preuve retourne `quiescent: false` — jamais de libération fail-open.
 */
export interface DockerAttemptFencingProofPort {
    proveFencedAttempt(attemptId: string): Promise<DockerAttemptFencingProof | null>;
}

export class DockerGatewayFencedAttemptProof implements DockerAttemptFencingProofPort {

    constructor(
        private readonly admission: Pick<DockerGatewayAdmissionPort, 'getFencedOperations'> = new MongoDockerGatewayAdmission(),
        private readonly control: Pick<DockerGatewayControlClient, 'fenceOperation' | 'verifyFenced'>,
        private readonly runner: DockerProcessRunner = createDockerProcessRunner(new SpawnDockerProcessRunner()),
    ) {}

    async proveFencedAttempt(attemptId: string): Promise<DockerAttemptFencingProof | null> {
        if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
            throw new Error('Attempt ID must be a lowercase UUID v4');
        }
        const containerName = DockerAttemptReservation.containerName(attemptId);
        const fenced = (await this.admission.getFencedOperations())
            .find((entry) => entry.effect?.attemptId === attemptId && entry.effect.containerName === containerName);
        if (!fenced) {
            // Aucune opération fencée ne correspond à la tentative : preuve absente.
            return null;
        }

        let quiescent = false;
        try {
            const fence = await this.control.fenceOperation(fenced.id);
            const verify = await this.control.verifyFenced(fenced.id);
            quiescent = fence.quiescent && verify.quiescent;
        } catch (error) {
            quiescent = false;
            console.error('[DockerGatewayFencedAttemptProof] Gateway control plane failed closed', {
                operationId: fenced.id,
                attemptId,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (!quiescent) {
            return { operationId: fenced.id, quiescent: false, containerState: null };
        }

        const containerState = await this.observeTerminalState(attemptId, containerName, fenced.id);
        if (!containerState) {
            return { operationId: fenced.id, quiescent: false, containerState: null };
        }
        return { operationId: fenced.id, quiescent: true, containerState };
    }

    /**
     * Observation read-only (`docker inspect` du nom, seule commande de lecture
     * autorisée par le gateway outre image/version/context/info) de l'état du
     * conteneur de la tentative. Elle ne décide jamais seule de la libération : elle
     * complète la preuve gateway (verifyFenced) pour le journal de réconciliation.
     * Toute incertitude (inspect en erreur, label mismatch, état inconnu) -> null.
     */
    private async observeTerminalState(
        attemptId: string,
        containerName: string,
        operationId: string,
    ): Promise<DockerAttemptQuiescentState | null> {
        let result;
        try {
            result = await this.runner.run('docker', ['inspect', containerName], { timeoutMs: INSPECT_TIMEOUT_MS });
        } catch {
            return null;
        }
        if (result.timedOut || result.errorMessage) return null;
        if (result.exitCode !== 0) {
            return /no such (?:object|container)/i.test(result.stderr) ? 'absent' : null;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(result.stdout);
        } catch {
            return null;
        }
        if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== 'object' || parsed[0] === null) {
            return null;
        }
        const container = parsed[0] as Record<string, unknown>;
        const config = container.Config;
        const state = container.State;
        if (typeof container.Id !== 'string' || !CONTAINER_ID_PATTERN.test(container.Id)) return null;
        if (container.Name !== `/${containerName}`
            || typeof config !== 'object' || config === null
            || typeof state !== 'object' || state === null) {
            return null;
        }
        const labels = (config as Record<string, unknown>).Labels;
        if (typeof labels !== 'object' || labels === null) return null;
        const status = String((state as Record<string, unknown>).Status);
        if (!(CONTAINER_STATES as readonly string[]).includes(status)) return null;

        const normalized = labels as Record<string, unknown>;
        // La réservation inerte occupe le nom sous le label de fencing : le conteneur
        // de la tentative a été supprimé (par ID) -> 'absent'.
        if (normalized[FENCE_LABEL] === operationId) return 'absent';
        if (normalized[ATTEMPT_LABEL] === attemptId && (TERMINAL_STATES as readonly string[]).includes(status)) {
            return status as DockerAttemptQuiescentState;
        }
        return null;
    }
}
