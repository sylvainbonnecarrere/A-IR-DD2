import { PatchWorkflowUseCase } from '../patchWorkflow.usecase';
import { IWorkflowRepository } from '../../../repositories/IWorkflowRepository';

describe('PatchWorkflowUseCase', () => {
  const workflowRepository = {
    patchOwned: jest.fn(),
  } as unknown as jest.Mocked<IWorkflowRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates partial workflow updates to the repository', async () => {
    const useCase = new PatchWorkflowUseCase(workflowRepository);
    workflowRepository.patchOwned.mockResolvedValue({
      kind: 'updated',
      workflow: { _id: 'wf-1' },
    } as any);

    const result = await useCase.execute({
      workflowId: 'wf-1',
      userId: 'user-1',
      setFields: { description: 'patched' },
      expectedVersion: 2,
    });

    expect(workflowRepository.patchOwned).toHaveBeenCalledWith(
      'wf-1',
      'user-1',
      { description: 'patched' },
      2,
    );
    expect(result).toEqual(expect.objectContaining({ kind: 'updated' }));
  });
});