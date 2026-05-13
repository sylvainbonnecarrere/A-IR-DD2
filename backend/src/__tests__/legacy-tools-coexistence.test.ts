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

    it('keeps stable read compatibility between /api/functions and /api/tools for canonically created tools', async () => {
        const user = await User.create({
            email: `coexistence-function-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `coexistence${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const createResponse = await request(app)
            .post('/api/tools')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                name: `coexistence_function_${Date.now()}`,
                description: 'Function created through canonical tools facade for coexistence testing.',
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

        const functionId = createResponse.body.tool.id;

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
            name: createResponse.body.tool.name,
            runtimeCompatibility: expect.objectContaining({
                warning: 'Docker Desktop is dev-only.'
            })
        }));
        expect(toolDetailResponse.body.tool).toEqual(expect.objectContaining({
            id: functionId,
            name: createResponse.body.tool.name,
            legacyFunctionId: functionId
        }));
    });

    it('supports create update toggle and delete through /api/tools while preserving legacy compatibility', async () => {
        const user = await User.create({
            email: `coexistence-function-tools-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `coexistencetools${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const createResponse = await request(app)
            .post('/api/tools')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                name: `coexistence_function_tools_${Date.now()}`,
                description: 'Function created through target tools facade for coexistence testing.',
                language: 'typescript',
                codeInline: 'export function run() { return { ok: true }; }',
                tags: ['coexistence', 'tools']
            })
            .expect(201);

        expect(createResponse.body.tool).toEqual(expect.objectContaining({
            id: expect.any(String),
            legacyFunctionId: expect.any(String),
            name: expect.stringContaining('coexistence_function_tools_'),
            runtime: 'typescript'
        }));
        expect(createResponse.body.runtimeCompatibility).toEqual(expect.objectContaining({
            preferredRunner: 'docker_sandbox'
        }));

        const toolId = createResponse.body.tool.id;

        const updateResponse = await request(app)
            .put(`/api/tools/${toolId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                description: 'Updated through canonical tools write path.',
                codeInline: 'export function run() { return { ok: "updated" }; }'
            })
            .expect(200);

        expect(updateResponse.body.tool).toEqual(expect.objectContaining({
            id: toolId,
            description: 'Updated through canonical tools write path.'
        }));

        const toggleResponse = await request(app)
            .patch(`/api/tools/${toolId}/toggle`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ allowBashPy: false })
            .expect(200);

        expect(toggleResponse.body).toEqual({ id: toolId, isEnabled: false });

        const [legacyDetailResponse, toolDetailResponse] = await Promise.all([
            request(app)
                .get(`/api/functions/${toolId}`)
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200),
            request(app)
                .get(`/api/tools/${toolId}`)
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200)
        ]);

        expect(legacyDetailResponse.body).toEqual(expect.objectContaining({
            _id: toolId,
            description: 'Updated through canonical tools write path.',
            isEnabled: false
        }));
        expect(toolDetailResponse.body.tool).toEqual(expect.objectContaining({
            id: toolId,
            description: 'Updated through canonical tools write path.',
            isEnabled: false,
            legacyFunctionId: toolId
        }));

        await request(app)
            .delete(`/api/tools/${toolId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(204);

        await Promise.all([
            request(app)
                .get(`/api/functions/${toolId}`)
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(404),
            request(app)
                .get(`/api/tools/${toolId}`)
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(404)
        ]);
    });

    it('keeps /api/tools writes out of user_functions while preserving /api/functions read compatibility', async () => {
        const user = await User.create({
            email: `coexistence-function-canonical-projection-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `coexistenceprojection${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const createResponse = await request(app)
            .post('/api/tools')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                name: `coexistence_function_projection_${Date.now()}`,
                description: 'Canonical tools write path must not create a legacy user_functions document.',
                language: 'typescript',
                codeInline: 'export function run() { return { ok: true, source: "canonical" }; }',
                tags: ['coexistence', 'projection']
            })
            .expect(201);

        const toolId = createResponse.body.tool.id;

        expect(await UserTool.findById(toolId).lean()).toEqual(expect.objectContaining({
            _id: expect.anything(),
            name: createResponse.body.tool.name,
            scopeType: 'user'
        }));
        expect(await UserFunction.findById(toolId).lean()).toBeNull();

        const legacyDetailAfterCreate = await request(app)
            .get(`/api/functions/${toolId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(legacyDetailAfterCreate.body).toEqual(expect.objectContaining({
            _id: toolId,
            name: createResponse.body.tool.name,
            description: 'Canonical tools write path must not create a legacy user_functions document.'
        }));

        await request(app)
            .put(`/api/tools/${toolId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                description: 'Updated through canonical tools write path without legacy persistence.',
                codeInline: 'export function run() { return { ok: true, source: "updated" }; }'
            })
            .expect(200);

        expect(await UserFunction.findById(toolId).lean()).toBeNull();

        const legacyDetailAfterUpdate = await request(app)
            .get(`/api/functions/${toolId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(legacyDetailAfterUpdate.body).toEqual(expect.objectContaining({
            _id: toolId,
            description: 'Updated through canonical tools write path without legacy persistence.'
        }));

        await request(app)
            .patch(`/api/tools/${toolId}/toggle`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ allowBashPy: false })
            .expect(200);

        expect(await UserFunction.findById(toolId).lean()).toBeNull();

        await request(app)
            .delete(`/api/tools/${toolId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(204);

        expect(await UserFunction.findById(toolId).lean()).toBeNull();
    });

    it('rejects legacy write routes and points clients to canonical command surfaces', async () => {
        const user = await User.create({
            email: `coexistence-function-canonical-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `coexistencecanonical${Date.now()}`
        });
        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const createToolResponse = await request(app)
            .post('/api/tools')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                name: `coexistence_function_canonical_${Date.now()}`,
                description: 'Function created through canonical tools facade before legacy write rejection checks.',
                language: 'typescript',
                codeInline: 'export function run() { return { ok: true }; }',
                tags: ['coexistence', 'canonical']
            })
            .expect(201);

        const functionId = createToolResponse.body.tool.id;

        const createLegacyResponse = await request(app)
            .post('/api/functions')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                name: `coexistence_function_legacy_blocked_${Date.now()}`,
                description: 'Legacy create must be blocked.',
                language: 'typescript',
                codeInline: 'export function run() { return { ok: false }; }'
            })
            .expect(410);

        const updateLegacyResponse = await request(app)
            .put(`/api/functions/${functionId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ description: 'Updated through frozen legacy facade.' })
            .expect(410);

        const toggleLegacyResponse = await request(app)
            .patch(`/api/functions/${functionId}/toggle`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ allowBashPy: false })
            .expect(410);

        const deleteLegacyResponse = await request(app)
            .delete(`/api/functions/${functionId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(410);

        const buildLegacyResponse = await request(app)
            .post(`/api/functions/${functionId}/build`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({})
            .expect(410);

        const cleanupLegacyResponse = await request(app)
            .post(`/api/functions/${functionId}/runs/cleanup`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ retentionDays: 14 })
            .expect(410);

        expect(createLegacyResponse.body).toEqual(expect.objectContaining({
            code: 'legacy_functions_read_only',
            canonical: { method: 'POST', path: '/api/tools' }
        }));
        expect(updateLegacyResponse.body).toEqual(expect.objectContaining({
            code: 'legacy_functions_read_only',
            canonical: { method: 'PUT', path: `/api/tools/${functionId}` }
        }));
        expect(toggleLegacyResponse.body).toEqual(expect.objectContaining({
            code: 'legacy_functions_read_only',
            canonical: { method: 'PATCH', path: `/api/tools/${functionId}/toggle` }
        }));
        expect(deleteLegacyResponse.body).toEqual(expect.objectContaining({
            code: 'legacy_functions_read_only',
            canonical: { method: 'DELETE', path: `/api/tools/${functionId}` }
        }));
        expect(buildLegacyResponse.body).toEqual(expect.objectContaining({
            code: 'legacy_functions_read_only',
            canonical: { method: 'POST', path: `/api/tools/${functionId}/build` }
        }));
        expect(cleanupLegacyResponse.body).toEqual(expect.objectContaining({
            code: 'legacy_functions_read_only',
            canonical: { method: 'POST', path: `/api/runs/tool/${functionId}/cleanup` }
        }));

        await request(app)
            .get(`/api/tools/${functionId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);
    });
});