export const RECONSTRUCTION_REJECTION_CODES = [
    'RUN_TARGET_NOT_FOUND',
    'RUN_TARGET_DISABLED',
    'RUN_TARGET_VERSION_NOT_FOUND',
    'RUN_TARGET_CHANGED',
    'RUN_TARGET_SNAPSHOT_MISSING',
    'RUN_TARGET_SOURCE_UNVERIFIED',
] as const;

export type RunReconstructionRejectionCode = typeof RECONSTRUCTION_REJECTION_CODES[number];

export function isReconstructionRejectionCode(code: string): code is RunReconstructionRejectionCode {
    return (RECONSTRUCTION_REJECTION_CODES as readonly string[]).includes(code);
}
