import {
    REACT_FLOW_TYPE_WARNING_EVENT,
    isReactFlowTypeStabilityWarning,
    registerReactFlowWarningProbe,
} from '../../utils/reactFlowWarningDiagnostics';

describe('reactFlowWarningDiagnostics', () => {
    beforeEach(() => {
        delete (window as Window & { __ARC_REACT_FLOW_WARNING_LOG__?: unknown[] }).__ARC_REACT_FLOW_WARNING_LOG__;
    });

    it('detects React Flow type stability warnings from console payloads', () => {
        expect(isReactFlowTypeStabilityWarning([
            "It looks like you've created a new nodeTypes or edgeTypes object.",
        ])).toBe(true);

        expect(isReactFlowTypeStabilityWarning(['A generic warning unrelated to React Flow.'])).toBe(false);
    });

    it('publishes a structured diagnostic event when the warning is intercepted', () => {
        const eventListener = jest.fn();
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        window.addEventListener(REACT_FLOW_TYPE_WARNING_EVENT, eventListener as EventListener);

        const unregister = registerReactFlowWarningProbe(() => ({
            mountId: 7,
            workflowId: 'workflow-qa',
            renderCount: 3,
            actualNodeCount: 2,
            nodeCount: 2,
            edgeCount: 1,
            nodeTypesStable: true,
            edgeTypesStable: true,
            styleStable: true,
            defaultViewportStable: true,
            proOptionsStable: true,
        }));

        console.warn("It looks like you've created a new nodeTypes or edgeTypes object.");

        expect(eventListener).toHaveBeenCalledTimes(1);
        const diagnostic = (eventListener.mock.calls[0][0] as CustomEvent).detail;
        expect(diagnostic).toEqual(expect.objectContaining({
            mountId: 7,
            workflowId: 'workflow-qa',
            nodeTypesStable: true,
            edgeTypesStable: true,
            warningText: expect.stringContaining('nodeTypes or edgeTypes'),
        }));
        expect((window as Window & { __ARC_REACT_FLOW_WARNING_LOG__?: unknown[] }).__ARC_REACT_FLOW_WARNING_LOG__).toEqual([
            expect.objectContaining({
                workflowId: 'workflow-qa',
                edgeCount: 1,
            })
        ]);

        unregister();
        window.removeEventListener(REACT_FLOW_TYPE_WARNING_EVENT, eventListener as EventListener);
        consoleWarnSpy.mockRestore();
    });
});