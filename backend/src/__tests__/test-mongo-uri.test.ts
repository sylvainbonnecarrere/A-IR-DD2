import mongoose from 'mongoose';
import { buildTestMongoUri } from './testMongoUri';

describe('isolated MongoDB test database', () => {
    it.each([
        [undefined, 'mongodb://localhost:27017/unique-test'],
        ['mongodb://localhost:27017', 'mongodb://localhost:27017/unique-test'],
        ['mongodb://127.0.0.1:27018', 'mongodb://127.0.0.1:27018/unique-test'],
        ['mongodb://[::1]:27018', 'mongodb://[::1]:27018/unique-test'],
        ['mongodb://localhost:27017/?retryWrites=false', 'mongodb://localhost:27017/unique-test?retryWrites=false'],
        ['mongodb://localhost:27017/existing?authSource=admin', 'mongodb://localhost:27017/unique-test?authSource=admin'],
    ])('builds a dedicated database URI from %s', (input, expected) => {
        expect(buildTestMongoUri(input, 'unique-test')).toBe(expected);
    });

    it.each([
        'mongodb://10.0.0.10:27017/existing',
        'mongodb://host1:27017,localhost:27017/existing',
        'mongodb+srv://cluster.example/existing?retryWrites=true',
    ])('refuses non-loopback MongoDB servers: %s', (input) => {
        expect(() => buildTestMongoUri(input, 'unique-test')).toThrow('loopback-only');
    });

    it('rejects invalid URLs and database names', () => {
        expect(() => buildTestMongoUri('https://localhost/database', 'unique-test')).toThrow('Invalid MongoDB URI');
        expect(() => buildTestMongoUri('mongodb://localhost', 'other/database')).toThrow('Invalid test database name');
    });

    it('connects the suite to a unique generated database', () => {
        expect(mongoose.connection.name).toMatch(/^irdd-test-\d+-[a-f0-9]{32}$/);
        expect(mongoose.connection.name).not.toBe('irdd-test-worker-1');
    });
});
