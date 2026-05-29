import type { AgentInstance, V2WorkflowNode } from '../types';

export const WORKFLOW_NODE_PLACEMENT_COLUMNS = 4;
export const WORKFLOW_NODE_PLACEMENT_ORIGIN = Object.freeze({ x: 20, y: 20 });
export const WORKFLOW_NODE_PLACEMENT_SPACING = Object.freeze({ x: 420, y: 540 });
export const WORKFLOW_NODE_COLLISION_BOX = Object.freeze({ width: 360, height: 460, padding: 20 });

interface Position {
    x: number;
    y: number;
}

interface Size {
    height?: number;
    width?: number;
}

interface FindAvailableWorkflowNodePositionParams {
    agentInstances: AgentInstance[];
    maxSlots?: number;
    nodes: V2WorkflowNode[];
    workflowId: string | null | undefined;
}

interface FindCollisionFreeWorkflowNodePositionParams {
    agentInstances: AgentInstance[];
    currentPosition?: Position;
    desiredPosition: Position;
    instanceId?: string;
    maxSearchRadius?: number;
    nodeId?: string;
    nodes: V2WorkflowNode[];
    occupiedNodeRects?: WorkflowNodeCollisionRect[];
    subjectSize?: Size;
    gestureVector?: Position;
    workflowId: string | null | undefined;
}

export interface WorkflowNodeCollisionRect {
    instanceId?: string;
    nodeId?: string;
    position: Position;
    height?: number;
    workflowId: string | null;
    width?: number;
}

type CollisionAxis = 'x' | 'y';

const hasFiniteCoordinates = (position: Partial<Position> | null | undefined): position is Position => {
    return Number.isFinite(position?.x) && Number.isFinite(position?.y);
};

const normalizeWorkflowId = (value: string | null | undefined): string | null => value ?? null;

const matchesWorkflow = (currentWorkflowId: string | null, candidateWorkflowId: string | null): boolean => {
    if (!currentWorkflowId) {
        return true;
    }

    return candidateWorkflowId === currentWorkflowId;
};

const collectOccupiedNodePositions = (
    nodes: V2WorkflowNode[],
    agentInstances: AgentInstance[],
): WorkflowNodeCollisionRect[] => {
    const fromNodes = nodes.flatMap((node) => {
        if (!hasFiniteCoordinates(node.position)) {
            return [];
        }

        return [{
            nodeId: node.id,
            instanceId: node.data?.agentInstance?.id,
            position: node.position,
            workflowId: normalizeWorkflowId(node.data?.workflowId ?? node.data?.agentInstance?.workflowId),
        }];
    });

    const fromInstances = agentInstances.flatMap((instance) => {
        if (!hasFiniteCoordinates(instance.position)) {
            return [];
        }

        return [{
            instanceId: instance.id,
            position: instance.position,
            workflowId: normalizeWorkflowId(instance.workflowId),
        }];
    });

    return [...fromNodes, ...fromInstances];
};

const rectanglesOverlap = (candidate: Position, occupied: Position): boolean => {
    const pad = WORKFLOW_NODE_COLLISION_BOX.padding ?? 0;

    const candidateLeft = candidate.x - pad;
    const candidateRight = candidate.x + WORKFLOW_NODE_COLLISION_BOX.width + pad;
    const candidateTop = candidate.y - pad;
    const candidateBottom = candidate.y + WORKFLOW_NODE_COLLISION_BOX.height + pad;

    const occupiedLeft = occupied.x - pad;
    const occupiedRight = occupied.x + WORKFLOW_NODE_COLLISION_BOX.width + pad;
    const occupiedTop = occupied.y - pad;
    const occupiedBottom = occupied.y + WORKFLOW_NODE_COLLISION_BOX.height + pad;

    // Edge-to-edge contact is considered a collision (inclusive checks)
    return candidateLeft <= occupiedRight
        && candidateRight >= occupiedLeft
        && candidateTop <= occupiedBottom
        && candidateBottom >= occupiedTop;
};

const resolveCollisionAxisSize = (value: number | undefined, fallback: number): number => (
    Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback
);

const resolveDirectionalGap = (subjectSize: Size | undefined, axis: CollisionAxis): number => {
    const fallback = axis === 'x' ? WORKFLOW_NODE_COLLISION_BOX.width : WORKFLOW_NODE_COLLISION_BOX.height;
    const size = resolveCollisionAxisSize(axis === 'x' ? subjectSize?.width : subjectSize?.height, fallback);

    return Math.max(1, Math.round(size / 8));
};

const rectanglesOverlapWithSize = (
    candidate: Position,
    occupied: WorkflowNodeCollisionRect,
    subjectSize?: Size,
): boolean => {
    const pad = WORKFLOW_NODE_COLLISION_BOX.padding ?? 0;
    const candidateWidth = resolveCollisionAxisSize(subjectSize?.width, WORKFLOW_NODE_COLLISION_BOX.width);
    const candidateHeight = resolveCollisionAxisSize(subjectSize?.height, WORKFLOW_NODE_COLLISION_BOX.height);
    const occupiedWidth = resolveCollisionAxisSize(occupied.width, WORKFLOW_NODE_COLLISION_BOX.width);
    const occupiedHeight = resolveCollisionAxisSize(occupied.height, WORKFLOW_NODE_COLLISION_BOX.height);

    const candidateLeft = candidate.x - pad;
    const candidateRight = candidate.x + candidateWidth + pad;
    const candidateTop = candidate.y - pad;
    const candidateBottom = candidate.y + candidateHeight + pad;

    const occupiedLeft = occupied.position.x - pad;
    const occupiedRight = occupied.position.x + occupiedWidth + pad;
    const occupiedTop = occupied.position.y - pad;
    const occupiedBottom = occupied.position.y + occupiedHeight + pad;

    // Edge-to-edge contact is considered a collision (inclusive checks)
    return candidateLeft <= occupiedRight
        && candidateRight >= occupiedLeft
        && candidateTop <= occupiedBottom
        && candidateBottom >= occupiedTop;
};

const isSamePosition = (left: Position, right: Position): boolean => left.x === right.x && left.y === right.y;

const buildSlotPosition = (column: number, row: number): Position => ({
    x: WORKFLOW_NODE_PLACEMENT_ORIGIN.x + column * WORKFLOW_NODE_PLACEMENT_SPACING.x,
    y: WORKFLOW_NODE_PLACEMENT_ORIGIN.y + row * WORKFLOW_NODE_PLACEMENT_SPACING.y,
});

const buildFallbackPosition = (maxSlots: number): Position => {
    const overflowRow = Math.floor(maxSlots / WORKFLOW_NODE_PLACEMENT_COLUMNS);
    return buildSlotPosition(0, overflowRow);
};

const collectCollidingEntries = (
    desiredPosition: Position,
    occupiedPositions: WorkflowNodeCollisionRect[],
    subjectSize?: Size,
): WorkflowNodeCollisionRect[] => occupiedPositions.filter((entry) => rectanglesOverlapWithSize(desiredPosition, entry, subjectSize));

const resolvePreferredAxis = (currentPosition: Position, desiredPosition: Position, gestureVector?: Position): CollisionAxis => {
    if (gestureVector && (Number.isFinite(gestureVector.x) || Number.isFinite(gestureVector.y))) {
        const gx = gestureVector.x ?? 0;
        const gy = gestureVector.y ?? 0;
        return Math.abs(gx) >= Math.abs(gy) ? 'x' : 'y';
    }

    const deltaX = desiredPosition.x - currentPosition.x;
    const deltaY = desiredPosition.y - currentPosition.y;

    return Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y';
};

const resolveDirectionalCandidate = ({
    collidingEntries,
    currentPosition,
    desiredPosition,
    subjectSize,
    gestureVector,
}: {
    collidingEntries: WorkflowNodeCollisionRect[];
    currentPosition: Position;
    desiredPosition: Position;
    subjectSize?: Size;
    gestureVector?: Position;
}): Position | null => {
    const preferredAxis = resolvePreferredAxis(currentPosition, desiredPosition, gestureVector);
    const deltaX = desiredPosition.x - currentPosition.x;
    const deltaY = desiredPosition.y - currentPosition.y;
    const subjectWidth = resolveCollisionAxisSize(subjectSize?.width, WORKFLOW_NODE_COLLISION_BOX.width);
    const subjectHeight = resolveCollisionAxisSize(subjectSize?.height, WORKFLOW_NODE_COLLISION_BOX.height);

    if (preferredAxis === 'x' && deltaX !== 0) {
        const gap = resolveDirectionalGap(subjectSize, 'x');
        const pad = WORKFLOW_NODE_COLLISION_BOX.padding ?? 0;

        return deltaX < 0
            ? {
                x: Math.max(...collidingEntries.map((entry) => entry.position.x + resolveCollisionAxisSize(entry.width, WORKFLOW_NODE_COLLISION_BOX.width) + pad + gap)),
                y: desiredPosition.y,
            }
            : {
                x: Math.min(...collidingEntries.map((entry) => entry.position.x - subjectWidth - pad - gap)),
                y: desiredPosition.y,
            };
    }

    if (preferredAxis === 'y' && deltaY !== 0) {
        const gap = resolveDirectionalGap(subjectSize, 'y');
        const pad = WORKFLOW_NODE_COLLISION_BOX.padding ?? 0;

        return deltaY < 0
            ? {
                x: desiredPosition.x,
                y: Math.max(...collidingEntries.map((entry) => entry.position.y + resolveCollisionAxisSize(entry.height, WORKFLOW_NODE_COLLISION_BOX.height) + pad + gap)),
            }
            : {
                x: desiredPosition.x,
                y: Math.min(...collidingEntries.map((entry) => entry.position.y - subjectHeight - pad - gap)),
            };
    }

    return null;
};

const resolveDirectionalCollision = ({
    currentPosition,
    desiredPosition,
    occupiedPositions,
    subjectSize,
    gestureVector,
}: {
    currentPosition?: Position;
    desiredPosition: Position;
    occupiedPositions: WorkflowNodeCollisionRect[];
    subjectSize?: Size;
    gestureVector?: Position;
}): Position | null => {
    if (!hasFiniteCoordinates(currentPosition)) {
        return null;
    }

    let candidate = desiredPosition;
    const maxIterations = Math.max(occupiedPositions.length * 2, 1);

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const collidingEntries = collectCollidingEntries(candidate, occupiedPositions, subjectSize);
        if (collidingEntries.length === 0) {
            return candidate;
        }

        const nextCandidate = resolveDirectionalCandidate({
            collidingEntries,
            currentPosition,
            desiredPosition: candidate,
            subjectSize,
            gestureVector,
        });

        if (!nextCandidate || isSamePosition(nextCandidate, candidate)) {
            return null;
        }

        candidate = nextCandidate;
    }

    return collectCollidingEntries(candidate, occupiedPositions, subjectSize).length === 0
        ? candidate
        : null;
};

const collectSearchCandidates = (desiredPosition: Position, maxSearchRadius: number, subjectSize?: Size): Position[] => {
    const candidates: Position[] = [desiredPosition];
    const seen = new Set<string>([`${desiredPosition.x}:${desiredPosition.y}`]);
    const pad = WORKFLOW_NODE_COLLISION_BOX.padding ?? 0;
    const width = resolveCollisionAxisSize(subjectSize?.width, WORKFLOW_NODE_COLLISION_BOX.width);
    const height = resolveCollisionAxisSize(subjectSize?.height, WORKFLOW_NODE_COLLISION_BOX.height);

    // Step sizes scaled to the subject size + padding to make search denser for small nodes and coarser for large ones
    const stepX = Math.max(1, Math.round((width + pad) / 4));
    const stepY = Math.max(1, Math.round((height + pad) / 4));

    for (let radius = 0; radius <= maxSearchRadius; radius += 1) {
        for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
            for (let columnOffset = -radius; columnOffset <= radius; columnOffset += 1) {
                if (Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) !== radius) {
                    continue;
                }

                const candidate = {
                    x: desiredPosition.x + columnOffset * stepX,
                    y: desiredPosition.y + rowOffset * stepY,
                };
                const candidateKey = `${candidate.x}:${candidate.y}`;

                if (seen.has(candidateKey)) {
                    continue;
                }

                seen.add(candidateKey);
                candidates.push(candidate);
            }
        }
    }

    return candidates;
};

const filterOccupiedPositionsForMove = (
    occupiedPositions: WorkflowNodeCollisionRect[],
    currentWorkflowId: string | null,
    nodeId?: string,
    instanceId?: string,
): WorkflowNodeCollisionRect[] => occupiedPositions.filter((entry) => {
    if (!matchesWorkflow(currentWorkflowId, entry.workflowId)) {
        return false;
    }

    if (nodeId && entry.nodeId === nodeId) {
        return false;
    }

    if (instanceId && entry.instanceId === instanceId) {
        return false;
    }

    return true;
});

export const findAvailableWorkflowNodePosition = ({
    agentInstances,
    maxSlots = 48,
    nodes,
    workflowId,
}: FindAvailableWorkflowNodePositionParams): Position => {
    const currentWorkflowId = normalizeWorkflowId(workflowId);
    const occupiedPositions = collectOccupiedNodePositions(nodes, agentInstances)
        .filter((entry) => matchesWorkflow(currentWorkflowId, entry.workflowId));

    for (let slotIndex = 0; slotIndex < maxSlots; slotIndex += 1) {
        const candidate = {
            x: WORKFLOW_NODE_PLACEMENT_ORIGIN.x + (slotIndex % WORKFLOW_NODE_PLACEMENT_COLUMNS) * WORKFLOW_NODE_PLACEMENT_SPACING.x,
            y: WORKFLOW_NODE_PLACEMENT_ORIGIN.y + Math.floor(slotIndex / WORKFLOW_NODE_PLACEMENT_COLUMNS) * WORKFLOW_NODE_PLACEMENT_SPACING.y,
        };

        const collides = occupiedPositions.some((entry) => rectanglesOverlap(candidate, entry.position));
        if (!collides) {
            return candidate;
        }
    }

    return buildFallbackPosition(maxSlots);
};

export const findCollisionFreeWorkflowNodePosition = ({
    agentInstances,
    currentPosition,
    desiredPosition,
    instanceId,
    maxSearchRadius = 8,
    nodeId,
    nodes,
    occupiedNodeRects,
    subjectSize,
    gestureVector,
    workflowId,
}: FindCollisionFreeWorkflowNodePositionParams): Position => {
    const currentWorkflowId = normalizeWorkflowId(workflowId);
    const occupiedPositions = filterOccupiedPositionsForMove(
        occupiedNodeRects ?? collectOccupiedNodePositions(nodes, agentInstances),
        currentWorkflowId,
        nodeId,
        instanceId,
    );

    const desiredPositionIsUsable = hasFiniteCoordinates(desiredPosition)
        && !occupiedPositions.some((entry) => rectanglesOverlapWithSize(desiredPosition, entry, subjectSize));

    if (desiredPositionIsUsable) {
        return desiredPosition;
    }

    const directionallyResolvedPosition = resolveDirectionalCollision({
        currentPosition,
        desiredPosition,
        occupiedPositions,
        subjectSize,
        gestureVector,
    });

    if (directionallyResolvedPosition) {
        return directionallyResolvedPosition;
    }

    const searchCandidates = collectSearchCandidates(desiredPosition, maxSearchRadius, subjectSize);
    for (const candidate of searchCandidates) {
        const collides = occupiedPositions.some((entry) => rectanglesOverlapWithSize(candidate, entry, subjectSize));
        if (!collides) {
            return candidate;
        }
    }

    const fallbackPosition = findAvailableWorkflowNodePosition({
        workflowId,
        nodes,
        agentInstances,
    });

    if (isSamePosition(fallbackPosition, desiredPosition)) {
        return buildFallbackPosition(48);
    }

    return fallbackPosition;
};