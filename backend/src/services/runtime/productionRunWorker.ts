import { randomUUID } from 'crypto';
import os from 'os';
import { SandboxService } from '../sandbox.service';
import { DurableRunWorker } from './DurableRunWorker';
import { MongoRunLeaseService } from './MongoRunLeaseService';
import { MonitoredRunDispatch } from './MonitoredRunDispatch';

const LEASE_DURATION_MS = 60_000;
const LEASE_MONITOR_INTERVAL_MS = 10_000;
const LEASE_MONITOR_TIMEOUT_MS = 10_000;
const WORKER_POLL_INTERVAL_MS = 1_000;

export function createProductionRunWorker(): DurableRunWorker {
    const sandbox = new SandboxService();
    const leases = new MongoRunLeaseService(LEASE_DURATION_MS);
    const dispatcher = new MonitoredRunDispatch(
        leases,
        sandbox,
        { execute: (request, prepare) => sandbox.executeLeasedRun(request, prepare) },
        {
            intervalMs: LEASE_MONITOR_INTERVAL_MS,
            timeoutMs: LEASE_MONITOR_TIMEOUT_MS,
            leaseDurationMs: LEASE_DURATION_MS,
        },
    );
    const owner = `api-worker:${os.hostname()}:${process.pid}:${randomUUID()}`;

    return new DurableRunWorker(owner, leases, dispatcher, WORKER_POLL_INTERVAL_MS);
}
