import { isValidWorkflowConnection } from '../../components/workflow/connectionContracts';

describe('WorkflowCanvas connection validation', () => {
    it('rejects self-loop connections on the same node', () => {
        expect(isValidWorkflowConnection({ source: 'node-1', target: 'node-1', sourceHandle: null, targetHandle: null })).toBe(false);
    });

    it('accepts connections between distinct nodes', () => {
        expect(isValidWorkflowConnection({ source: 'node-1', target: 'node-2', sourceHandle: null, targetHandle: null })).toBe(true);
    });

    it('rejects incomplete connections', () => {
        expect(isValidWorkflowConnection({ source: 'node-1', target: null, sourceHandle: null, targetHandle: null })).toBe(false);
        expect(isValidWorkflowConnection({ source: null, target: 'node-2', sourceHandle: null, targetHandle: null })).toBe(false);
    });
});