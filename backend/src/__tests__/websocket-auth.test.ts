import { createServer } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { generateAccessToken } from '../utils/jwt';

type ConnectionStatus = 'connected' | 'disconnected' | 'error';

async function createUser(label: string) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const user = await User.create({
        email: `websocket-auth-${label}-${suffix}@test.com`,
        password: 'Password123',
        username: `wsauth${label}${suffix}`,
        role: 'user',
        isActive: true,
    });

    const accessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
    });

    return { user, accessToken };
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

describe('WebSocketManager authentication and ownership', () => {
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

    it('allows an authenticated owner to join their workflow room', async () => {
        const owner = await createUser('owner');
        const workflow = await Workflow.create({
            userId: owner.user._id,
            name: 'Socket owned workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const socket = ioClient(baseUrl, {
            auth: { token: owner.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(socket, 'connected');
        socket.emit('workspace:join', workflow.id);

        const connectedUserId = await waitFor(() => wsManager.getConnectedUsers(workflow.id)[0] || null);
        expect(connectedUserId).toBe(owner.user.id);

        socket.disconnect();
    });

    it('rejects guest users from joining a protected workflow room', async () => {
        const owner = await createUser('guest-owner');
        const workflow = await Workflow.create({
            userId: owner.user._id,
            name: 'Guest denied workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const socket = ioClient(baseUrl, {
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(socket, 'connected');
        socket.emit('workspace:join', workflow.id);
        await waitForStatus(socket, 'error');

        expect(wsManager.getConnectedUsers(workflow.id)).toEqual([]);

        socket.disconnect();
    });

    it('rejects authenticated users from joining another user workflow room', async () => {
        const owner = await createUser('room-owner');
        const intruder = await createUser('intruder');
        const workflow = await Workflow.create({
            userId: owner.user._id,
            name: 'Forbidden workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        const socket = ioClient(baseUrl, {
            auth: { token: intruder.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
        });

        await waitForStatus(socket, 'connected');
        socket.emit('workspace:join', workflow.id);
        await waitForStatus(socket, 'error');

        expect(wsManager.getConnectedUsers(workflow.id)).toEqual([]);

        socket.disconnect();
    });
});