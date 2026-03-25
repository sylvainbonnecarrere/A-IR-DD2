/**
 * UserRepository.test.ts - Test unitaires du repository utilisateur
 * Applique: Repository Pattern + Unit Testing
 */

import { UserRepository } from '../UserRepository';
import { User, IUser } from '../../models/User.model';
import mongoose from 'mongoose';

// Mock Mongoose User model
jest.mock('../../models/User.model');

describe('UserRepository', () => {
  let repository: UserRepository;
  const userId = new mongoose.Types.ObjectId().toString();
  const email = 'test@test.fr';

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new UserRepository();
  });

  describe('findById', () => {
    it('should find user by ID', async () => {
      const mockUser: Partial<IUser> = {
        _id: new mongoose.Types.ObjectId(userId),
        email,
        workflowCount: 0
      };

      (User.findById as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser)
      });

      const result = await repository.findById(userId);

      expect(result).toEqual(mockUser);
      expect(User.findById).toHaveBeenCalledWith(userId);
    });

    it('should return null if user not found', async () => {
      (User.findById as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue(null)
      });

      const result = await repository.findById(userId);

      expect(result).toBeNull();
    });
  });

  describe('setDefaultWorkflow', () => {
    it('should set default workflow for user', async () => {
      const workflowId = new mongoose.Types.ObjectId().toString();
      const mockUser: Partial<IUser> = {
        _id: new mongoose.Types.ObjectId(userId),
        email,
        defaultWorkflowId: new mongoose.Types.ObjectId(workflowId)
      };

      (User.findByIdAndUpdate as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser)
      });

      const result = await repository.setDefaultWorkflow(userId, workflowId);

      expect(result).toEqual(mockUser);
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        userId,
        {
          $set: expect.objectContaining({
            defaultWorkflowId: workflowId,
            lastActiveWorkflowId: workflowId,
            updatedAt: expect.any(Date)
          })
        },
        { new: true }
      );
    });

    it('should throw error if user not found', async () => {
      (User.findByIdAndUpdate as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue(null)
      });

      await expect(
        repository.setDefaultWorkflow(userId, 'workflowId')
      ).rejects.toThrow('not found');
    });
  });

  describe('syncWorkflowCount', () => {
    it('should update workflow count', async () => {
      const mockUser: Partial<IUser> = {
        _id: new mongoose.Types.ObjectId(userId),
        workflowCount: 3
      };

      (User.findByIdAndUpdate as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser)
      });

      const result = await repository.syncWorkflowCount(userId, 3);

      expect(result.workflowCount).toBe(3);
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          $set: expect.objectContaining({
            workflowCount: 3
          })
        }),
        { new: true }
      );
    });
  });

  describe('getDefaultWorkflowId', () => {
    it('should get default workflow ID', async () => {
      const workflowId = new mongoose.Types.ObjectId().toString();
      const mockUser: Partial<IUser> = {
        defaultWorkflowId: new mongoose.Types.ObjectId(workflowId)
      };

      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockUser)
        })
      });

      const result = await repository.getDefaultWorkflowId(userId);

      expect(result).toBe(workflowId);
    });

    it('should return null if no default workflow', async () => {
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null)
        })
      });

      const result = await repository.getDefaultWorkflowId(userId);

      expect(result).toBeNull();
    });
  });
});
