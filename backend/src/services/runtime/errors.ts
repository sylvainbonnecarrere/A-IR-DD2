export class RuntimeNotReadyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RuntimeNotReadyError';
    }
}
