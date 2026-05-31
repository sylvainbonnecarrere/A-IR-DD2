export const HYDRATION_COMPONENT_READY_EVENT = 'arc:hydration-component-ready';
export const HYDRATION_LAYOUT_MARK_EVENT = 'arc:hydration-layout-mark';

export type HydrationReadySource = 'workflow-canvas-stable' | 'bos-media-button';

export interface HydrationComponentReadyDetail {
    source: HydrationReadySource;
    workflowId?: string | null;
    nodeCount?: number;
    layoutShiftCount?: number;
    width?: number;
    height?: number;
    occurredAt: string;
}

export interface HydrationLayoutMark {
    source: string;
    workflowId?: string | null;
    width?: number;
    height?: number;
    count?: number;
    note?: string;
    occurredAt: string;
}

type DiagnosticWindow = Window & {
    __ARC_HYDRATION_READY_LOG__?: HydrationComponentReadyDetail[];
    __ARC_HYDRATION_LAYOUT_LOG__?: HydrationLayoutMark[];
};

export function publishHydrationComponentReady(
    detail: Omit<HydrationComponentReadyDetail, 'occurredAt'>,
): void {
    if (typeof window === 'undefined') {
        return;
    }

    const payload: HydrationComponentReadyDetail = {
        ...detail,
        occurredAt: new Date().toISOString(),
    };

    try {
        const targetWindow = window as DiagnosticWindow;
        const existingLog = targetWindow.__ARC_HYDRATION_READY_LOG__ ?? [];
        existingLog.push(payload);
        targetWindow.__ARC_HYDRATION_READY_LOG__ = existingLog;

        window.dispatchEvent(new CustomEvent(HYDRATION_COMPONENT_READY_EVENT, {
            detail: payload,
        }));
    } catch {
        // ignore diagnostic publication failures
    }
}

export function recordHydrationLayoutMark(
    mark: Omit<HydrationLayoutMark, 'occurredAt'>,
): void {
    if (typeof window === 'undefined') {
        return;
    }

    const payload: HydrationLayoutMark = {
        ...mark,
        occurredAt: new Date().toISOString(),
    };

    try {
        const targetWindow = window as DiagnosticWindow;
        const existingLog = targetWindow.__ARC_HYDRATION_LAYOUT_LOG__ ?? [];
        existingLog.push(payload);
        targetWindow.__ARC_HYDRATION_LAYOUT_LOG__ = existingLog;

        window.dispatchEvent(new CustomEvent(HYDRATION_LAYOUT_MARK_EVENT, {
            detail: payload,
        }));
    } catch {
        // ignore diagnostic publication failures
    }
}