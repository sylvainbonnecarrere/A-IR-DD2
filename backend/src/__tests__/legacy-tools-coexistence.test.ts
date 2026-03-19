import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserFunction } from '../models/UserFunction.model';
import { UserTool } from '../models/UserTool.model';
import functionsRoutes from '../routes/functions.routes';
import toolsRoutes from '../routes/tools.routes';
import { RuntimeHealthService } from '../services/runtimeHealth.service';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/functions', functionsRoutes);
app.use('/api/tools', toolsRoutes);

describe('Legacy functions and target tools coexistence', () => {
    const runtimeHealthSpy = jest.spyOn(RuntimeHealthService.prototype, 'getHealthReport');

    beforeEach(() => {
        runtimeHealthSpy.mockResolvedValue({
            status: 'healthy',
            checkedAt: '2026-01-01T00:00:00.000Z',
            summary: 'Runtime ready in dev mode.',
            components: [],
            runtime: {
                node: { available: true, status: 'healthy', executable: 'node', version: '24.8.0' },
                python: { available: true, status: 'healthy', executable: 'python3', version: '3.11.0' },
                docker: {
                    available: true,
                    status: 'healthy',
                    executable: 'docker',
                    version: '27.0.0',
                    rootless: false,
                    mode: 'docker-desktop',
                    securityLevel: 'dev-only',
                    executionReady: true,
                    warning: 'Docker Desktop is dev-only.'
                },
                images: {
                    node: { available: true, status: 'healthy', image: 'airdd2/node' },
                    python: { available: true, status: 'healthy', image: 'airdd2/python' }
                },
                runners: {
                    preferred: 'docker_sandbox',
                    dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'healthy' },
                    firecracker: { runner: 'firecracker', available: false, status: 'degraded', detail: 'Not configured' }
                },
                typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
            },
            capabilities: {
                build: { typescript: true, python: true },
                run: { typescript: true, python: true, dockerRootless: false }
            },
            python: { available: true, executable: 'python3', version: '3.11.0' },
            typescript: { available: true, engine: 'node-subprocess' }
        } as any);
    });

    afterEach(async () => {
        runtimeHealthSpy.mockReset();
        await UserTool.deleteMany({ name: /coexistence-function-/i });
        await UserFunction.deleteMany({ name: /coexistence-function-/i });
        await User.deleteMany({ email: /coexistence-function-/i });
    });

    it('keeps stable ids between /api/functions and /api/tools without cutover', async () => {
        const user = await User.create({
            email: `coexistence-function-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `coexistence${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const createResponse = await request(app)
            .post('/api/functions')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                name: `coexistence_function_${Date.now()}`,
                description: 'Function created through legacy facade for coexistence testing.',
                language: 'typescript',
                codeInline: 'export function run() { return { ok: true }; }',
                tags: ['coexistence']
            })
            .expect(201);

        expect(createResponse.headers['x-runtime-security-level']).toBe('dev-only');
        expect(createResponse.body.runtimeCompatibility).toEqual(expect.objectContaining({
            preferredRunner: 'docker_sandbox',
            securityLevel: 'dev-only'
        }));

        const functionId = createResponse.body._id;

        const [functionsResponse, toolsResponse, functionDetailResponse, toolDetailResponse] = await Promise.all([
            request(app)
                .get('/api/functions')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200),
            request(app)
                .get('/api/tools')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200),
            request(app)
                .get(`/api/functions/${functionId}`)
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200),
            request(app)
                .get(`/api/tools/${functionId}`)
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200)
        ]);

        const legacyFunction = functionsResponse.body.find((item: any) => item._id === functionId);
        const targetTool = toolsResponse.body.items.find((item: any) => item.id === functionId);

        expect(functionsResponse.headers['x-runtime-preferred-runner']).toBe('docker_sandbox');
        expect(toolsResponse.headers['x-runtime-preferred-runner']).toBe('docker_sandbox');
        expect(legacyFunction).toEqual(expect.objectContaining({
            _id: functionId,
            runtimeCompatibility: expect.objectContaining({
                securityLevel: 'dev-only'
            })
        }));
        expect(targetTool).toEqual(expect.objectContaining({
            id: functionId,
            legacyFunctionId: functionId,
            compatibilityAliases: { functionId }
        }));
        expect(functionDetailResponse.body).toEqual(expect.objectContaining({
            _id: functionId,
            name: createResponse.body.name,
            runtimeCompatibility: expect.objectContaining({
                warning: 'Docker Desktop is dev-only.'
            })
        }));
        expect(toolDetailResponse.body.tool).toEqual(expect.objectContaining({
            id: functionId,
            name: createResponse.body.name,
            legacyFunctionId: functionId
        }));
    });
});