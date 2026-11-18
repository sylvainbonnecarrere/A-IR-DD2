import { readFileSync } from 'fs';
import path from 'path';

describe('production build entrypoints', () => {
    const backendRoot = path.resolve(__dirname, '../..');

    it('keeps npm and systemd entrypoints aligned with the TypeScript output layout', () => {
        const config = JSON.parse(readFileSync(path.join(backendRoot, 'tsconfig.json'), 'utf8')) as {
            compilerOptions: { rootDir: string; outDir: string };
        };
        const manifest = JSON.parse(readFileSync(path.join(backendRoot, 'package.json'), 'utf8')) as {
            main: string;
            scripts: { start: string; 'start:docker-gateway': string };
        };
        const outputFor = (source: string) => path.posix.join(
            config.compilerOptions.outDir,
            path.posix.relative(config.compilerOptions.rootDir, source),
        ).replace(/\.ts$/, '.js');
        const backendEntry = outputFor('src/server.ts');
        const gatewayEntry = outputFor('src/services/runtime/dockerGatewayMain.ts');
        const backendUnit = readFileSync(path.join(backendRoot, 'deploy/systemd/airdd2-backend.service'), 'utf8');
        const gatewayUnit = readFileSync(path.join(backendRoot, 'deploy/systemd/airdd2-docker-gateway.service'), 'utf8');

        expect(manifest.main).toBe(backendEntry);
        expect(manifest.scripts.start).toBe(`node ${backendEntry}`);
        expect(manifest.scripts['start:docker-gateway']).toBe(`node ${gatewayEntry}`);
        expect(backendUnit).toContain(`ExecStart=/usr/bin/env node ${backendEntry}`);
        expect(gatewayUnit).toContain(`ExecStart=/usr/bin/env node ${gatewayEntry}`);
    });
});
