import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { CloudConnectionProfile } from '../models/CloudConnectionProfile.model';

describe('CloudConnectionProfile Model', () => {
    let testUserId: mongoose.Types.ObjectId;

    beforeAll(async () => {
        const user = await User.create({
            email: `cloud-profile-model-${Date.now()}@test.com`,
            password: 'Password123',
            username: `cloudprofilemodel${Date.now()}`,
            role: 'user',
            isActive: true
        });

        testUserId = user._id as mongoose.Types.ObjectId;
        await CloudConnectionProfile.syncIndexes();
    });

    beforeEach(async () => {
        await CloudConnectionProfile.deleteMany({});
    });

    afterAll(async () => {
        await CloudConnectionProfile.deleteMany({ userId: testUserId });
        await User.deleteMany({ _id: testUserId });
    });

    it('encrypts S3 secret material and rebuilds a decrypted config', async () => {
        const profile = await CloudConnectionProfile.create({
            userId: testUserId,
            displayName: 'Media S3',
            provider: 's3',
            enabled: true,
            target: {
                bucketName: 'media-bucket',
                region: 'eu-west-3',
                endpoint: 'https://s3.example.test',
                forcePathStyle: true,
                keyPrefix: 'workflow/outputs/'
            },
            statusState: 'missing_secret'
        });

        profile.setSecretMaterial({
            provider: 's3',
            s3: {
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'super-secret-key',
                bucketName: 'media-bucket',
                region: 'eu-west-3',
                endpoint: 'https://s3.example.test',
                forcePathStyle: true,
                keyPrefix: 'workflow/outputs/'
            }
        });

        await profile.save();

        expect(profile.hasSecretMaterial()).toBe(true);
        expect(profile.secretEnvelope?.payloadEncrypted).toBeDefined();
        expect(profile.secretEnvelope?.payloadEncrypted).not.toContain('super-secret-key');

        expect(profile.toDecryptedCloudStorageConfig()).toEqual({
            provider: 's3',
            s3: {
                accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
                secretAccessKey: 'super-secret-key',
                bucketName: 'media-bucket',
                region: 'eu-west-3',
                endpoint: 'https://s3.example.test',
                forcePathStyle: true,
                keyPrefix: 'workflow/outputs/'
            }
        });

        expect(profile.getSafeSecretSummary()).toEqual(expect.objectContaining({
            accessKeyIdMasked: expect.stringContaining('MPLE'),
            secretAccessKeyPresent: true
        }));
    });

    it('enforces a unique displayName per user', async () => {
        await CloudConnectionProfile.create({
            userId: testUserId,
            displayName: 'Shared Cloud',
            provider: 'gcs',
            enabled: true,
            target: {
                projectId: 'project-alpha',
                bucketName: 'gcs-bucket'
            },
            statusState: 'missing_secret'
        });

        await expect(CloudConnectionProfile.create({
            userId: testUserId,
            displayName: 'Shared Cloud',
            provider: 's3',
            enabled: true,
            target: {
                bucketName: 'other-bucket',
                region: 'us-east-1'
            },
            statusState: 'missing_secret'
        })).rejects.toThrow(/E11000|duplicate key/i);
    });
});