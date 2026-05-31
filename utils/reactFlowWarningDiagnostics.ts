export const REACT_FLOW_TYPE_WARNING_EVENT = 'arc:reactflow:type-warning';

export interface ReactFlowWarningProbeSnapshot {
    mountId: number;
    workflowId: string;
    renderCount: number;
    actualNodeCount: number;
    nodeCount: number;
    edgeCount: number;
    nodeTypesStable: boolean;
    edgeTypesStable: boolean;
    styleStable: boolean;
    defaultViewportStable: boolean;
    proOptionsStable: boolean;
}

export interface ReactFlowTypeWarningDiagnostic extends ReactFlowWarningProbeSnapshot {
    occurredAt: string;
    warningText: string;
}

type ReactFlowWarningProbe = () => ReactFlowWarningProbeSnapshot | null;

type DiagnosticWindow = Window & {
    __ARC_REACT_FLOW_WARNING_LOG__?: ReactFlowTypeWarningDiagnostic[];
};

const reactFlowWarningProbes = new Set<ReactFlowWarningProbe>();

let originalConsoleWarn: typeof console.warn | null = null;
let patchedConsoleWarn: typeof console.warn | null = null;

function normalizeConsoleArgument(argument: unknown): string {
    if (typeof argument === 'string') {
        return argument;
    }

    if (argument instanceof Error) {
        return argument.message;
    }

    try {
        return JSON.stringify(argument);
    } catch {
        return String(argument);
    }
}

function normalizeWarningText(argumentsList: unknown[]): string {
    return argumentsList.map(normalizeConsoleArgument).join(' ');
}

export function isReactFlowTypeStabilityWarning(argumentsList: unknown[]): boolean {
    const normalizedText = normalizeWarningText(argumentsList).toLowerCase();
    const mentionsTypeObjects = normalizedText.includes('nodetypes') || normalizedText.includes('edgetypes');
    const mentionsRecreation = normalizedText.includes('created a new')
        || normalizedText.includes('new nodetypes')
        || normalizedText.includes('new edgetypes')
        || normalizedText.includes('define the nodetypes')
        || normalizedText.includes('define the edgetypes');

    return mentionsTypeObjects && mentionsRecreation;
}

function publishReactFlowTypeWarningDiagnostic(diagnostic: ReactFlowTypeWarningDiagnostic): void {
    if (typeof window === 'undefined') {
        return;
    }

    const targetWindow = window as DiagnosticWindow;
    const existingLog = targetWindow.__ARC_REACT_FLOW_WARNING_LOG__ ?? [];
    existingLog.push(diagnostic);
    targetWindow.__ARC_REACT_FLOW_WARNING_LOG__ = existingLog;

    window.dispatchEvent(new CustomEvent(REACT_FLOW_TYPE_WARNING_EVENT, {
        detail: diagnostic,
    }));

    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
        console.info('[WorkflowCanvas] React Flow warning diagnostic', diagnostic);
    }
}

function ensureReactFlowWarningProbeInstalled(): void {
    if (patchedConsoleWarn) {
        return;
    }

    originalConsoleWarn = console.warn.bind(console);
    patchedConsoleWarn = (...argumentsList: unknown[]) => {
        originalConsoleWarn?.(...argumentsList);

        if (!isReactFlowTypeStabilityWarning(argumentsList)) {
            return;
        }

        const warningText = normalizeWarningText(argumentsList);
        for (const probe of reactFlowWarningProbes) {
            const snapshot = probe();
            if (!snapshot) {
                continue;
            }

            publishReactFlowTypeWarningDiagnostic({
                ...snapshot,
                occurredAt: new Date().toISOString(),
                warningText,
            });
        }
    };

    console.warn = patchedConsoleWarn;
}

function maybeTeardownReactFlowWarningProbe(): void {
    if (reactFlowWarningProbes.size > 0 || !patchedConsoleWarn) {
        return;
    }

    if (console.warn === patchedConsoleWarn && originalConsoleWarn) {
        console.warn = originalConsoleWarn;
    }

    patchedConsoleWarn = null;
    originalConsoleWarn = null;
}

export function registerReactFlowWarningProbe(probe: ReactFlowWarningProbe): () => void {
    reactFlowWarningProbes.add(probe);
    ensureReactFlowWarningProbeInstalled();

    return () => {
        reactFlowWarningProbes.delete(probe);
        maybeTeardownReactFlowWarningProbe();
    };
}