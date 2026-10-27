import { buildWorkflowOwnershipResolver } from '../workflowAccess';

describe('buildWorkflowOwnershipResolver', () => {
  it('resolves the actual owner from the workflow repository', async () => {
    const workflowRepository = {
      findById: jest.fn().mockResolvedValue({ _id: 'wf-1', userId: 'user-1' }),
    } as any;

    const resolveOwnership = buildWorkflowOwnershipResolver(workflowRepository);

    const result = await resolveOwnership('wf-1', 'user-1');

    expect(workflowRepository.findById).toHaveBeenCalledWith('wf-1');
    expect(result).toBe('user-1');
  });

  it('returns the workflow owner id when another user owns the resource', async () => {
    const workflowRepository = {
      findById: jest.fn().mockResolvedValue({ _id: 'wf-2', userId: 'user-2' }),
    } as any;

    const resolveOwnership = buildWorkflowOwnershipResolver(workflowRepository);

    await expect(resolveOwnership('wf-2', 'user-1')).resolves.toBe('user-2');
  });

  it('returns null when the workflow does not exist', async () => {
    const workflowRepository = {
      findById: jest.fn().mockResolvedValue(null),
    } as any;

    const resolveOwnership = buildWorkflowOwnershipResolver(workflowRepository);

    await expect(resolveOwnership('wf-3', 'user-1')).resolves.toBeNull();
  });
});
