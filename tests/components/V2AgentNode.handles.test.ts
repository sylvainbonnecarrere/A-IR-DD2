import { Position } from 'reactflow';
import { AGENT_NODE_HANDLES } from '../../components/workflow/connectionContracts';

describe('V2AgentNode handle topology', () => {
    it('exposes one left handle and one right handle for workflow linking', () => {
        expect(AGENT_NODE_HANDLES).toEqual([
            expect.objectContaining({
                id: 'target-top-left',
                type: 'target',
                position: Position.Left,
                style: { top: 0 },
            }),
            expect.objectContaining({
                id: 'source-top-right',
                type: 'source',
                position: Position.Right,
                style: { top: 0 },
            }),
        ]);
    });
});