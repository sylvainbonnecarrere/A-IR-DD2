import { createServer } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { generateAccessToken } from '../utils/jwt';
import { buildRuntimeEvent } from '../domain/execution/runtimeEvent.contract';

type ConnectionStatus = 'connected' | 'disconnected' | 'error';

async function createUser(label: string, overrides: { isActive?: boolean } = {}) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const user = await User.create({
        email: `websocket-auth-${label}-${suffix}@test.com`,
        password: 'Password123',
        username: `wsauth${label}${suffix}`,
        role: 'user',
        isActive: overrides.isActive ?? true,
    });

    const accessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
    });

    return { user, accessToken };
}

async function createWorkflow(ownerId: unknown, name: string) {
    return Workflow.create({
        userId: ownerId as any,
        name,
        isActive: true,
        isDefault: false,
        canvasState: { zoom: 1, panX: 0, panY: 0 },
    });
}

function waitForStatus(socket: ClientSocket, expectedStatus: ConnectionStatus): Promise<ConnectionStatus> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off('connection:status', handler);
            reject(new Error(`Timed out waiting for connection:status=${expectedStatus}`));
        }, 2000);

        const handler = (status: ConnectionStatus) => {
            if (status !== expectedStatus) {
                return;
            }
            clearTimeout(timer);
            socket.off('connection:status', handler);
            resolve(status);
        };

        socket.on('connection:status', handler);
    });
}

function waitForConnectError(socket: ClientSocket, timeoutMs = 2000): Promise<Error> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off('connect_error', handler);
            reject(new Error('Timed out waiting for connect_error'));
        }, timeoutMs);

        const handler = (error: Error) => {
            clearTimeout(timer);
            socket.off('connect_error', handler);
            resolve(error);
        };

        socket.on('connect_error', handler);
    });
}

function waitFor<T>(predicate: () => T | null | undefined, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
            const value = predicate();
            if (value) {
                resolve(value);
                return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
                reject(new Error('Timed out waiting for condition'));
                return;
            }
            setTimeout(tick, 25);
        };
        tick();
    });
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`Timed out waiting for event ${event}`));
        }, timeoutMs);

        const handler = (data: T) => {
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(data);
        };

        socket.on(event, handler);
    });
}

describe('WebSocketManager authentication and ownership (US-J7-12 — JWT strict)', () => {
    let httpServer: ReturnType<typeof createServer>;
    let wsManager: WebSocketManager;
    let baseUrl: string;

    beforeAll(async () => {
        httpServer = createServer(express());
        wsManager = new WebSocketManager(httpServer);

        await new Promise<void>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => resolve());
        });

        const address = httpServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await wsManager.close();
        if (httpServer.listening) {
            await new Promise<void>((resolve, reject) => {
                httpServer.close((error) => error ? reject(error) : resolve());
            });
        }
    });

    // ===== US-J7-12 : Connexion sans JWT -> refusée (deny by default) =====

    it('rejects connection without any JWT token (no guest userId created)', async () => {
        const socket = ioClient(baseUrl, {
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        const error = await waitForConnectError(socket);
        expect(error.message).toMatch(/SOCKET_AUTH_REQUIRED|authentication/i);
        expect(socket.connected).toBe(false);

        socket.disconnect();
    });

    it('rejects connection with an invalid JWT token', async () => {
        const socket = ioClient(baseUrl, {
            auth: { token: 'invalid.jwt.token' },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        const error = await waitForConnectError(socket);
        expect(error.message).toMatch(/SOCKET_AUTH_INVALID|authentication/i);
        expect(socket.connected).toBe(false);

        socket.disconnect();
    });

    it('rejects connection with a valid JWT for an inactive user', async () => {
        const inactive = await createUser('inactive', { isActive: false });

        const socket = ioClient(baseUrl, {
            auth: { token: inactive.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        const error = await waitForConnectError(socket);
        expect(error.message).toMatch(/SOCKET_AUTH_INVALID|authentication/i);
        expect(socket.connected).toBe(false);

        socket.disconnect();
    });

    it('rejects connection with a Bearer header containing an invalid token', async () => {
        const socket = ioClient(baseUrl, {
            extraHeaders: { authorization: 'Bearer not-a-real-token' },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        const error = await waitForConnectError(socket);
        expect(error.message).toMatch(/SOCKET_AUTH_INVALID|authentication/i);

        socket.disconnect();
    });

    // ===== US-J7-12 : Connexion avec JWT valide -> acceptée =====

    it('allows an authenticated owner to connect and join their workflow room', async () => {
        const owner = await createUser('owner');
        const workflow = await createWorkflow(owner.user._id, 'Socket owned workflow');

        const socket = ioClient(baseUrl, {
            auth: { token: owner.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(socket, 'connected');
        socket.emit('workspace:join', workflow._id.toString());

        const connectedUserId = await waitFor(() => wsManager.getConnectedUsers(workflow._id.toString())[0] || null);
        expect(connectedUserId).toBe(owner.user.id);
        // US-J7-12: userId is the real MongoDB _id, never a guest: prefix
        expect(connectedUserId).not.toMatch(/^guest:/);

        socket.disconnect();
    });

    // ===== US-J7-12 : Join refusé pour non-propriétaire =====

    it('rejects authenticated users from joining another user workflow room', async () => {
        const owner = await createUser('room-owner');
        const intruder = await createUser('intruder');
        const workflow = await createWorkflow(owner.user._id, 'Forbidden workflow');

        const socket = ioClient(baseUrl, {
            auth: { token: intruder.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(socket, 'connected');
        socket.emit('workspace:join', workflow._id.toString());
        await waitForStatus(socket, 'error');

        expect(wsManager.getConnectedUsers(workflow._id.toString())).toEqual([]);

        socket.disconnect();
    });

    it('rejects workspace:join with an invalid workspaceId format', async () => {
        const owner = await createUser('invalid-ws');

        const socket = ioClient(baseUrl, {
            auth: { token: owner.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(socket, 'connected');
        socket.emit('workspace:join', 'not-an-object-id');
        await waitForStatus(socket, 'error');

        socket.disconnect();
    });

    // ===== US-J7-12 : Aucun userId temporaire dans le code source =====

    it('has no temporary guest userId in the WebSocketManager source code', () => {
        const sourcePath = path.resolve(__dirname, '../websocket/WebSocketManager.ts');
        const source = fs.readFileSync(sourcePath, 'utf-8');
        expect(source).not.toMatch(/guest:/i);
        expect(source).not.toMatch(/isAuthenticated/);
    });

    it('has no temporary guest userId in the socketAuth middleware source code', () => {
        const sourcePath = path.resolve(__dirname, '../middleware/socketAuth.middleware.ts');
        const source = fs.readFileSync(sourcePath, 'utf-8');
        expect(source).not.toMatch(/guest:/i);
    });

    // ===== US-J7-12 : Filtrage strict workspaceId sur les événements runtime =====

    it('emits runtime events only to the matching workspace room', async () => {
        const owner = await createUser('rt-owner');
        const workflow = await createWorkflow(owner.user._id, 'Runtime workflow');

        const socket = ioClient(baseUrl, {
            auth: { token: owner.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(socket, 'connected');
        socket.emit('workspace:join', workflow._id.toString());
        await waitFor(() => wsManager.getConnectedUsers(workflow._id.toString()).length > 0 ? true : null);

        const event = buildRuntimeEvent({
            type: 'run:started',
            aggregateType: 'run',
            aggregateId: 'run-123',
            workspaceId: workflow._id.toString(),
            payload: { status: 'running', runId: 'run-123' },
        });

        const receivedPromise = waitForEvent<any>(socket, 'runtime:event');
        const emitted = wsManager.emitRuntimeEvent(workflow.id, event);
        expect(emitted).toBe(true);

        const received = await receivedPromise;
        expect(received.type).toBe('run:started');
        expect(received.workspaceId).toBe(workflow._id.toString());

        socket.disconnect();
    });

    it('rejects runtime event when event.workspaceId does not match the room workspaceId', async () => {
        const owner = await createUser('rt-mismatch');
        const workflowA = await createWorkflow(owner.user._id, 'Workflow A');
        const workflowB = await createWorkflow(owner.user._id, 'Workflow B');

        // Event declared for workflowB but emitted to room workflowA -> must be rejected
        const event = buildRuntimeEvent({
            type: 'run:queued',
            aggregateType: 'run',
            aggregateId: 'run-456',
            workspaceId: workflowB._id.toString(),
            payload: { status: 'queued', runId: 'run-456' },
        });

        const emitted = wsManager.emitRuntimeEvent(workflowA.id, event);
        expect(emitted).toBe(false);
    });

    it('rejects runtime event with invalid workspaceId format', () => {
        const event = {
            id: 'evt-test',
            type: 'run:started',
            version: 1,
            aggregateType: 'run',
            aggregateId: 'run-789',
            workspaceId: 'not-valid',
            occurredAt: new Date().toISOString(),
            payload: { status: 'running' },
        };

        const emitted = wsManager.emitRuntimeEvent('not-an-object-id', event);
        expect(emitted).toBe(false);
    });

    it('rejects malformed runtime event payload', () => {
        const emitted = wsManager.emitRuntimeEvent('507f1f77bcf86cd799439011', { garbage: true });
        expect(emitted).toBe(false);
    });

    // ===== US-J7-12 : Événements de quarantaine (US-J7-09) filtrés par workspace =====

    it('emits run:quarantined event only to the owner workspace room', async () => {
        const owner = await createUser('quarantine-owner');
        const intruder = await createUser('quarantine-intruder');
        const ownerWorkflow = await createWorkflow(owner.user._id, 'Quarantine owner ws');
        const intruderWorkflow = await createWorkflow(intruder.user._id, 'Quarantine intruder ws');

        const ownerSocket = ioClient(baseUrl, {
            auth: { token: owner.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });
        const intruderSocket = ioClient(baseUrl, {
            auth: { token: intruder.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(ownerSocket, 'connected');
        await waitForStatus(intruderSocket, 'connected');

        ownerSocket.emit('workspace:join', ownerWorkflow._id.toString());
        intruderSocket.emit('workspace:join', intruderWorkflow._id.toString());

        await waitFor(() => wsManager.getConnectedUsers(ownerWorkflow._id.toString()).length > 0 ? true : null);
        await waitFor(() => wsManager.getConnectedUsers(intruderWorkflow._id.toString()).length > 0 ? true : null);

        const quarantineEvent = buildRuntimeEvent({
            type: 'run:quarantined',
            aggregateType: 'run',
            aggregateId: 'run-quarantine-1',
            workspaceId: ownerWorkflow._id.toString(),
            payload: { status: 'quarantined', lockHeld: true, reason: 'worker_lost_no_fencing_proof', runId: 'run-quarantine-1' },
        });

        let intruderReceived: any = null;
        intruderSocket.on('runtime:event', (data) => { intruderReceived = data; });

        const ownerReceivedPromise = waitForEvent<any>(ownerSocket, 'runtime:event');
        const emitted = wsManager.emitRuntimeEvent(ownerWorkflow.id, quarantineEvent);
        expect(emitted).toBe(true);

        const ownerReceived = await ownerReceivedPromise;
        expect(ownerReceived.type).toBe('run:quarantined');
        expect(ownerReceived.payload.lockHeld).toBe(true);

        // L'intruder ne doit rien recevoir (filtrage strict par workspaceId)
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(intruderReceived).toBeNull();

        ownerSocket.disconnect();
        intruderSocket.disconnect();
    });

    // ===== US-J7-12 : canAccessWorkspace =====

    it('canAccessWorkspace returns true only for the workspace owner', async () => {
        const owner = await createUser('access-owner');
        const intruder = await createUser('access-intruder');
        const workflow = await createWorkflow(owner.user._id, 'Access control ws');

        expect(await wsManager.canAccessWorkspace(owner.user.id, workflow._id.toString())).toBe(true);
        expect(await wsManager.canAccessWorkspace(intruder.user.id, workflow._id.toString())).toBe(false);
        expect(await wsManager.canAccessWorkspace(owner.user.id, 'not-an-object-id')).toBe(false);
    });

    // ===== US-J7-12 : Reconnexion avec token frais =====

    it('reconnection with a fresh valid JWT is accepted (no implicit session)', async () => {
        const owner = await createUser('reconnect');
        const workflow = await createWorkflow(owner.user._id, 'Reconnect ws');

        // Première connexion
        const socket1 = ioClient(baseUrl, {
            auth: { token: owner.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });
        await waitForStatus(socket1, 'connected');
        socket1.emit('workspace:join', workflow._id.toString());
        await waitFor(() => wsManager.getConnectedUsers(workflow._id.toString()).length > 0 ? true : null);
        socket1.disconnect();

        // Reconnexion avec un nouveau token frais
        const freshToken = generateAccessToken({
            sub: owner.user.id,
            email: owner.user.email,
            role: owner.user.role,
        });
        const socket2 = ioClient(baseUrl, {
            auth: { token: freshToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });
        await waitForStatus(socket2, 'connected');
        socket2.emit('workspace:join', workflow._id.toString());
        const connectedUserId = await waitFor(() => wsManager.getConnectedUsers(workflow._id.toString())[0] || null);
        expect(connectedUserId).toBe(owner.user.id);

        socket2.disconnect();
    });
});
