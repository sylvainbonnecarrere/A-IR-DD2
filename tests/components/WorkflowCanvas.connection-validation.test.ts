import { isValidWorkflowConnection } from '../../components/workflow/connectionContracts';

describe('WorkflowCanvas connection validation', () => {
    it('rejects self-loop connections on the same node', () => {
        expect(isValidWorkflowConnection({ source: 'node-1', target: 'node-1' })).toBe(false);
    });

    it('accepts connections between distinct nodes', () => {
        expect(isValidWorkflowConnection({ source: 'node-1', target: 'node-2' })).toBe(true);
    });

    it('rejects incomplete connections', () => {
        expect(isValidWorkflowConnection({ source: 'node-1', target: null })).toBe(false);
        expect(isValidWorkflowConnection({ source: null, target: 'node-2' })).toBe(false);
    });
});