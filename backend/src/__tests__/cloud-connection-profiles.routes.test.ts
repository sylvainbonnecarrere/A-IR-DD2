import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import cloudConnectionProfilesRoutes from '../routes/cloud-connection-profiles.routes';
import { User } from '../models/User.model';
import { CloudConnectionProfile } from '../models/CloudConnectionProfile.model';
import { generateAccessToken } from '../utils/jwt';
import { S3StorageStrategy } from '../services/s3Storage.service';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/cloud-connection-profiles', cloudConnectionProfilesRoutes);

async function cleanupFixtures() {
    await CloudConnectionProfile.deleteMany({ displayName: /cloud-profile-route-/i });
    await User.deleteMany({ email: /cloud-profile-route-/i });
}

async function createUserFixture(label: string) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const user = await User.create({
        email: `cloud-profile-route-${label}-${suffix}@test.com`,
        password: 'Password123',
        username: `cloudprofile${label}${suffix}`,
        role: 'user',
        isActive: true
    });

    const accessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role
    });

    return { user, accessToken };
}

describe('Cloud connection profiles routes', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await cleanupFixtures();
    });

    it('creates an S3 profile and never returns raw secrets', async () => {
        const fixture = await createUserFixture('create');

        const response = await request(app)
            .post('/api/cloud-connection-profiles')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                displayName: 'cloud-profile-route-s3',
                provider: 's3',
                enabled: true,
                s3: {
                    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                    secretAccessKey: 'super-secret-key',
                    bucketName: 'team-bucket',
                    region: 'eu-west-3',
                    keyPrefix: 'workflow/'
                }
            })
            .expect(201);

        expect(response.body).toEqual(expect.objectContaining({
            displayName: 'cloud-profile-route-s3',
            provider: 's3',
            enabled: true,
            hasSecretMaterial: true,
            target: expect.objectContaining({
                bucketName: 'team-bucket',
                region: 'eu-west-3',
                keyPrefix: 'workflow/'
            }),
            status: expect.objectContaining({
                state: 'never_tested'
            }),
            secretSummary: expect.objectContaining({
                accessKeyIdMasked: expect.stringContaining('MPLE'),
                secretAccessKeyPresent: true
            })
        }));

        expect(response.body).not.toHaveProperty('secretEnvelope');
        expect(JSON.stringify(response.body)).not.toContain('super-secret-key');
        expect(JSON.stringify(response.body)).not.toContain('AKIAIOSFODNN7EXAMPLE');

        const persisted = await CloudConnectionProfile.findOne({
            userId: fixture.user._id,
            displayName: 'cloud-profile-route-s3'
        });

        expect(persisted?.secretEnvelope?.payloadEncrypted).toBeDefined();
        expect(persisted?.statusState).toBe('never_tested');
    });

    it('tests a stored profile through the provider strategy and updates validation status', async () => {
        const fixture = await createUserFixture('test');
        const profile = await CloudConnectionProfile.create({
            userId: fixture.user._id,
            displayName: 'cloud-profile-route-test',
            provider: 's3',
            enabled: true,
            target: {
                bucketName: 'test-bucket',
                region: 'eu-west-3'
            },
            statusState: 'missing_secret'
        });

        profile.setSecretMaterial({
            provider: 's3',
            s3: {
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'super-secret-key',
                bucketName: 'test-bucket',
                region: 'eu-west-3'
            }
        });
        await profile.save();

        jest.spyOn(S3StorageStrategy.prototype, 'initialize').mockResolvedValue(undefined);
        jest.spyOn(S3StorageStrategy.prototype, 'testConnection').mockResolvedValue({
            success: true,
            message: 'Connexion S3 réussie - Bucket: test-bucket',
            details: {
                bucketExists: true,
                hasWriteAccess: true,
                hasReadAccess: true
            }
        });

        const response = await request(app)
            .post(`/api/cloud-connection-profiles/${profile.id}/test`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            message: 'Connexion S3 réussie - Bucket: test-bucket'
        }));

        const refreshed = await CloudConnectionProfile.findById(profile._id);
        expect(refreshed?.statusState).toBe('configured');
        expect(refreshed?.lastValidatedAt).toBeInstanceOf(Date);
    });
});