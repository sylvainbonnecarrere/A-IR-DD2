import { User } from '../models/User.model';
import { LocalLLMProfile } from '../models/LocalLLMProfile.model';
import { isEndpointAccessibleForUser, normalizeEndpointForComparison } from '../services/localEndpointAccess.service';

async function cleanupFixtures() {
    const users = await User.find({ email: /local-endpoint-access-/i }).select('_id').lean();
    const userIds = users.map((user) => user._id);

    if (userIds.length > 0) {
        await LocalLLMProfile.deleteMany({ userId: { $in: userIds } });
    }

    await User.deleteMany({ email: /local-endpoint-access-/i });
}

async function createUserFixture(label: string) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    return User.create({
        email: `local-endpoint-access-${label}-${suffix}@test.com`,
        password: 'Password123',
        username: `localendpoint${label}${suffix}`,
        role: 'user',
        isActive: true,
    });
}

describe('localEndpointAccess.service', () => {
    afterEach(async () => {
        await cleanupFixtures();
    });

    it('allows any endpoint explicitly saved in the authenticated user local profiles', async () => {
        const user = await createUserFixture('saved-profile');
        await LocalLLMProfile.create({
            userId: user.id,
            name: 'Remote LM Studio',
            endpoint: 'https://lmstudio.internal.example:8443/',
            capabilities: {},
            enabled: true,
        });

        await expect(isEndpointAccessibleForUser('https://lmstudio.internal.example:8443', user.id)).resolves.toBe(true);
    });

    it('still rejects non-local endpoints when they are not saved for the user', async () => {
        const user = await createUserFixture('unsaved-profile');

        await expect(isEndpointAccessibleForUser('https://lmstudio.internal.example:8443', user.id)).resolves.toBe(false);
    });

    it('normalizes trailing slashes before comparing saved endpoints', () => {
        expect(normalizeEndpointForComparison('http://localhost:1337/')).toBe('http://localhost:1337');
        expect(normalizeEndpointForComparison('https://server.example.com/base/')).toBe('https://server.example.com/base');
    });
});
