import { useAppShellStore } from '../../stores/useAppShellStore';

describe('useAppShellStore', () => {
  beforeEach(() => {
    useAppShellStore.getState().resetGuestShellState();
  });

  it('keeps transient shell state isolated from workflow runtime state', () => {
    const store = useAppShellStore.getState();

    store.setCurrentPath('/bos/dashboard');
    store.setShowHyperspace(true);
    store.setCurrentImageNodeId('node-1');
    store.setCurrentVideoNodeId('node-2');
    store.setFullscreenImage({ src: 'image', mimeType: 'image/png' });

    expect(useAppShellStore.getState().currentPath).toBe('/bos/dashboard');
    expect(useAppShellStore.getState().showHyperspace).toBe(true);
    expect(useAppShellStore.getState().currentImageNodeId).toBe('node-1');
    expect(useAppShellStore.getState().currentVideoNodeId).toBe('node-2');
    expect(useAppShellStore.getState().fullscreenImage).toEqual({ src: 'image', mimeType: 'image/png' });

    store.resetGuestShellState();

    expect(useAppShellStore.getState().currentPath).toBe('/bos/dashboard');
    expect(useAppShellStore.getState().showHyperspace).toBe(false);
    expect(useAppShellStore.getState().currentImageNodeId).toBeNull();
    expect(useAppShellStore.getState().currentVideoNodeId).toBeNull();
    expect(useAppShellStore.getState().fullscreenImage).toBeNull();
  });
});
