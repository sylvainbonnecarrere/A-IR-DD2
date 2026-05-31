import type { Connection } from 'reactflow';
import { Position } from 'reactflow';

export const AGENT_NODE_HANDLES = [
    {
        id: 'target-top-left',
        type: 'target' as const,
        position: Position.Left,
        style: { top: 0 },
    },
    {
        id: 'source-top-right',
        type: 'source' as const,
        position: Position.Right,
        style: { top: 0 },
    },
];

export function isValidWorkflowConnection(connection: Connection): boolean {
    if (!connection.source || !connection.target) {
        return false;
    }

    return connection.source !== connection.target;
}