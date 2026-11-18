import { DockerAttemptReservation } from '../../services/runtime/DockerAttemptReservation';

async function main(): Promise<void> {
    const [action, imageId, attemptId] = process.argv.slice(2);
    if (!imageId || !attemptId || !['create', 'create-and-wait', 'recover'].includes(action)) throw new Error('Action, image ID and attempt ID are required');
    const service = new DockerAttemptReservation(imageId);
    const reservation = action === 'recover' ? await service.recover(attemptId) : await service.reserve(attemptId);
    process.stdout.write(`${JSON.stringify(reservation)}\n`);
    if (action === 'create-and-wait') setInterval(() => undefined, 1000);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Recovery failed');
    process.exitCode = 1;
});
