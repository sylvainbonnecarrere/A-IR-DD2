import { resolveActiveWorkflowId } from '../../services/workflowIdResolver';

describe('workflowIdResolver', () => {
  it('prefers the design store current workflow id over the legacy workflow store', () => {
    expect(resolveActiveWorkflowId({
      designWorkflowId: 'wf-design',
      designWorkflows: [{ _id: 'wf-design', isActive: false }],
      legacyWorkflowId: 'wf-legacy',
    })).toBe('wf-design');
  });

  it('falls back to the active design workflow when no explicit design selection exists', () => {
    expect(resolveActiveWorkflowId({
      designWorkflowId: null,
      designWorkflows: [
        { _id: 'wf-1', isActive: false },
        { _id: 'wf-2', isActive: true },
      ],
      legacyWorkflowId: null,
    })).toBe('wf-2');
  });

  it('falls back to the first design workflow before using the legacy workflow store', () => {
    expect(resolveActiveWorkflowId({
      designWorkflowId: undefined,
      designWorkflows: [
        { _id: 'wf-first', isActive: false },
        { _id: 'wf-second', isActive: false },
      ],
      legacyWorkflowId: 'wf-legacy',
    })).toBe('wf-first');
  });

  it('uses the legacy workflow id only when the design store has no workflow identity', () => {
    expect(resolveActiveWorkflowId({
      designWorkflowId: '',
      designWorkflows: [],
      legacyWorkflowId: 'wf-legacy',
    })).toBe('wf-legacy');
  });
});