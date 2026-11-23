import type { Connection } from 'reactflow';
import { Position } from 'reactflow';

export const AGENT_NODE_HANDLES = [
    {
        id: 'target-top-left',
        type: 'target' as const,
        position: Position.Left,
        // ⭐ 2026-11-21 : sphère remontée de 8px au-dessus du bord du node (empiète sur la marge)
        style: { top: -8 },
    },
    {
        id: 'source-top-right',
        type: 'source' as const,
        position: Position.Right,
        // ⭐ 2026-11-21 : sphère remontée de 8px au-dessus du bord du node (empiète sur la marge)
        style: { top: -8 },
    },
];

export function isValidWorkflowConnection(connection: Connection): boolean {
    if (!connection.source || !connection.target) {
        return false;
    }

    return connection.source !== connection.target;
}