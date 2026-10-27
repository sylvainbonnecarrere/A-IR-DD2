import { WorkflowValidator } from '../validators/workflow-validator';

describe('WorkflowValidator', () => {
  const validator = new WorkflowValidator();

  it('accepts an empty graph and a simple acyclic graph', () => {
    expect(validator.validateGraph([], []).valid).toBe(true);

    const result = validator.validateGraph(
      [
        { _id: 'node-1', nodeType: 'agent', instanceId: 'inst-1' } as any,
        { _id: 'node-2', nodeType: 'agent', instanceId: 'inst-2' } as any,
      ],
      [
        { sourceInstanceId: 'inst-1', targetInstanceId: 'inst-2' },
      ],
    );

    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('rejects agent nodes without executable instance references', () => {
    const result = validator.validateGraph(
      [
        { _id: 'node-1', nodeType: 'agent', instanceId: undefined } as any,
      ],
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toEqual(expect.objectContaining({ code: 'MISSING_AGENT_INSTANCE' }));
  });

  it('rejects agent nodes bound to instance ids not present in the workflow instance set', () => {
    const result = validator.validateGraph(
      [
        { _id: 'node-1', nodeType: 'agent', instanceId: 'inst-2' } as any,
      ],
      [],
      ['inst-1'],
      true,
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toEqual(expect.objectContaining({ code: 'MISSING_AGENT_INSTANCE' }));
  });

  it('rejects agent nodes bound to instance ids when the workflow instance set is empty in strict activation mode', () => {
    const result = validator.validateGraph(
      [
        { _id: 'node-1', nodeType: 'agent', instanceId: 'inst-2' } as any,
      ],
      [],
      [],
      true,
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toEqual(expect.objectContaining({ code: 'MISSING_AGENT_INSTANCE' }));
  });

  it('rejects edges pointing to missing instances', () => {
    const result = validator.validateGraph(
      [
        { _id: 'node-1', nodeType: 'agent', instanceId: 'inst-1' } as any,
      ],
      [
        { sourceInstanceId: 'inst-1', targetInstanceId: 'inst-2' },
      ],
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toEqual(expect.objectContaining({ code: 'BROKEN_EDGE_REFERENCE' }));
  });

  it('rejects cyclic graphs', () => {
    const result = validator.validateGraph(
      [
        { _id: 'node-1', nodeType: 'agent', instanceId: 'inst-1' } as any,
        { _id: 'node-2', nodeType: 'agent', instanceId: 'inst-2' } as any,
      ],
      [
        { sourceInstanceId: 'inst-1', targetInstanceId: 'inst-2' },
        { sourceInstanceId: 'inst-2', targetInstanceId: 'inst-1' },
      ],
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toEqual(expect.objectContaining({ code: 'CYCLE_DETECTED' }));
  });
});