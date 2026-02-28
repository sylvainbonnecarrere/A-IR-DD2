/**
 * WorkflowMigrationService.test.ts - Tests unitaires pour le service de migration
 * Applique: Test-driven development et isolation des dépendances
 */

import { WorkflowMigrationService } from '../WorkflowMigrationService';
import { IUserRepository } from '../../repositories/IUserRepository';
import { IWorkflowRepository } from '../../repositories/IWorkflowRepository';
import { IWorkflow } from '../../models/Workflow.model';
import { IUser } from '../../models/User.model';
import mongoose from 'mongoose';

// Mock repositories
const mockUserRepository: IUserRepository = {
  findById: jest.fn(),
  findByEmail: jest.fn(),
  setDefaultWorkflow: jest.fn(),
  syncWorkflowCount: jest.fn(),
  getDefaultWorkflowId: jest.fn()
};

const mockWorkflowRepository: IWorkflowRepository = {
  findByUserId: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  countByUserId: jest.fn(),
  findFirstByUserId: jest.fn()
};

describe('WorkflowMigrationService', () => {
  let service: WorkflowMigrationService;
  const userId = new mongoose.Types.ObjectId().toString();
  const workflowId = new mongoose.Types.ObjectId().toString();

  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkflowMigrationService(mockUserRepository, mockWorkflowRepository);
  });

  describe('ensureUserHasDefaultWorkflow', () => {
    describe('USER NOT FOUND', () => {
      it('should return error if user does not exist', async () => {
        (mockUserRepository.findById as jest.Mock).mockResolvedValue(null);

        const result = await service.ensureUserHasDefaultWorkflow(userId);

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
        expect(result.workflow).toBeNull();
      });
    });

    describe('USER ALREADY HAS DEFAULT WORKFLOW', () => {
      it('should return current workflow if user already has one', async () => {
        const mockUser: Partial<IUser> = {
          _id: new mongoose.Types.ObjectId(userId),
          email: 'test@test.fr',
          defaultWorkflowId: new mongoose.Types.ObjectId(workflowId)
        };

        const mockWorkflow: Partial<IWorkflow> = {
          _id: new mongoose.Types.ObjectId(workflowId),
          name: 'Existing Workflow',
          userId: new mongoose.Types.ObjectId(userId),
          isActive: true,
          isDefault: true
        };

        (mockUserRepository.findById as jest.Mock).mockResolvedValue(mockUser);
        (mockWorkflowRepository.findById as jest.Mock).mockResolvedValue(mockWorkflow);

        const result = await service.ensureUserHasDefaultWorkflow(userId);

        expect(result.success).toBe(true);
        expect(result.action).toBe('already_set');
        expect(result.workflow).toEqual(mockWorkflow);
        expect(mockUserRepository.setDefaultWorkflow).not.toHaveBeenCalled();
      });
    });

    describe('LEGACY USER WITH NO DEFAULT WORKFLOW BUT HAS WORKFLOWS', () => {
      it('should assign first workflow as default for legacy users', async () => {
        const mockUser: Partial<IUser> = {
          _id: new mongoose.Types.ObjectId(userId),
          email: 'legacy@test.fr',
          defaultWorkflowId: undefined
        };

        const existingWorkflow: Partial<IWorkflow> = {
          _id: new mongoose.Types.ObjectId(workflowId),
          name: 'First Workflow',
          userId: new mongoose.Types.ObjectId(userId),
          isActive: true,
          isDefault: false
        };

        const updatedUser: Partial<IUser> = {
          ...mockUser,
          defaultWorkflowId: new mongoose.Types.ObjectId(workflowId)
        };

        (mockUserRepository.findById as jest.Mock).mockResolvedValue(mockUser);
        (mockWorkflowRepository.findByUserId as jest.Mock).mockResolvedValue([existingWorkflow]);
        (mockUserRepository.setDefaultWorkflow as jest.Mock).mockResolvedValue(updatedUser);
        (mockWorkflowRepository.countByUserId as jest.Mock).mockResolvedValue(1);
        (mockUserRepository.syncWorkflowCount as jest.Mock).mockResolvedValue(updatedUser);

        const result = await service.ensureUserHasDefaultWorkflow(userId);

        expect(result.success).toBe(true);
        expect(result.action).toBe('assigned');
        expect(result.workflow?._id.toString()).toBe(workflowId);
        expect(mockUserRepository.setDefaultWorkflow).toHaveBeenCalledWith(userId, workflowId);
      });
    });

    describe('BRAND NEW USER WITH NO WORKFLOWS', () => {
      it('should create default workflow for new users', async () => {
        const mockUser: Partial<IUser> = {
          _id: new mongoose.Types.ObjectId(userId),
          email: 'newuser@test.fr',
          defaultWorkflowId: undefined
        };

        const newWorkflow: Partial<IWorkflow> = {
          _id: new mongoose.Types.ObjectId(workflowId),
          name: 'Mon Workflow',
          userId: new mongoose.Types.ObjectId(userId),
          isActive: true,
          isDefault: true
        };

        const updatedUser: Partial<IUser> = {
          ...mockUser,
          defaultWorkflowId: new mongoose.Types.ObjectId(workflowId)
        };

        (mockUserRepository.findById as jest.Mock).mockResolvedValue(mockUser);
        (mockWorkflowRepository.findByUserId as jest.Mock).mockResolvedValue([]);
        (mockWorkflowRepository.create as jest.Mock).mockResolvedValue(newWorkflow);
        (mockUserRepository.setDefaultWorkflow as jest.Mock).mockResolvedValue(updatedUser);
        (mockWorkflowRepository.countByUserId as jest.Mock).mockResolvedValue(1);
        (mockUserRepository.syncWorkflowCount as jest.Mock).mockResolvedValue(updatedUser);

        const result = await service.ensureUserHasDefaultWorkflow(userId);

        expect(result.success).toBe(true);
        expect(result.action).toBe('created');
        expect(result.workflow?.name).toBe('Mon Workflow');
        expect(mockWorkflowRepository.create).toHaveBeenCalled();
      });
    });

    describe('ERROR HANDLING', () => {
      it('should handle repository errors gracefully', async () => {
        const error = new Error('Database connection lost');
        (mockUserRepository.findById as jest.Mock).mockRejectedValue(error);

        const result = await service.ensureUserHasDefaultWorkflow(userId);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Database connection lost');
        expect(result.workflow).toBeNull();
      });
    });

    describe('IDEMPOTENCE', () => {
      it('should be idempotent - calling twice returns same result', async () => {
        const mockUser: Partial<IUser> = {
          _id: new mongoose.Types.ObjectId(userId),
          email: 'test@test.fr',
          defaultWorkflowId: undefined
        };

        const newWorkflow: Partial<IWorkflow> = {
          _id: new mongoose.Types.ObjectId(workflowId),
          name: 'Default Workflow',
          userId: new mongoose.Types.ObjectId(userId),
          isActive: true,
          isDefault: true
        };

        // First call - creates workflow
        (mockUserRepository.findById as jest.Mock)
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce({ ...mockUser, defaultWorkflowId: new mongoose.Types.ObjectId(workflowId) });

        (mockWorkflowRepository.findByUserId as jest.Mock)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([newWorkflow]);

        (mockWorkflowRepository.create as jest.Mock).mockResolvedValue(newWorkflow);
        (mockUserRepository.setDefaultWorkflow as jest.Mock).mockResolvedValue({
          ...mockUser,
          defaultWorkflowId: new mongoose.Types.ObjectId(workflowId)
        });
        (mockWorkflowRepository.countByUserId as jest.Mock).mockResolvedValue(1);
        (mockUserRepository.syncWorkflowCount as jest.Mock).mockResolvedValue({});
        (mockWorkflowRepository.findById as jest.Mock).mockResolvedValue(newWorkflow);

        // Execute twice
        const result1 = await service.ensureUserHasDefaultWorkflow(userId);
        const result2 = await service.ensureUserHasDefaultWorkflow(userId);

        // Both should succeed
        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);

        // First creates, second finds existing
        expect(result1.action).toBe('created');
        expect(result2.action).toBe('already_set');
      });
    });
  });

  describe('createDefaultWorkflow', () => {
    it('should create workflow with correct defaults', async () => {
      const newWorkflow: Partial<IWorkflow> = {
        _id: new mongoose.Types.ObjectId(workflowId),
        userId: new mongoose.Types.ObjectId(userId),
        name: 'Mon Workflow',
        description: 'Workflow créé automatiquement pour débuter',
        isActive: true,
        isDefault: true
      };

      (mockWorkflowRepository.create as jest.Mock).mockResolvedValue(newWorkflow);

      const result = await service.createDefaultWorkflow(userId);

      expect(result).toEqual(newWorkflow);
      expect(mockWorkflowRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Mon Workflow',
          isActive: true,
          isDefault: true
        })
      );
    });
  });
});
