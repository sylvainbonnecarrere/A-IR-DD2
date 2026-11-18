import type { RunReconstructionRejectionCode } from '../../domain/execution/runReconstructionQuarantine';

export class RunReconstructionRejection extends Error {
    constructor(readonly code: RunReconstructionRejectionCode) {
        super(`Queued run reconstruction rejected: ${code}`);
        this.name = 'RunReconstructionRejection';
    }
}
