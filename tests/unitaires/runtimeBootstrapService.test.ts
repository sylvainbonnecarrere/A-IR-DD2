import apiClient from '../../utils/apiClient';
import * as localLLMProfileService from '../../services/localLLMProfileService';
import {
  loadAuthenticatedRuntimeBootstrap,
  resetRuntimeBootstrapLoadCacheForTests,
} from '../../services/runtimeBootstrapService';

jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock('../../services/localLLMProfileService', () => ({
  __esModule: true,
  getAllProfiles: jest.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

describe('runtimeBootstrapService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRuntimeBootstrapLoadCacheForTests();
  });

  test('deduplicates concurrent authenticated bootstrap loads for the same token', async () => {
    const keysDeferred = createDeferred<{ data: Array<{ provider: string; enabled: boolean; apiKey: string }> }>();
    const profilesDeferred = createDeferred<Array<{ id: string; name: string; provider: string; endpoint: string }>>();

    jest.spyOn(apiClient, 'post').mockImplementationOnce(() => keysDeferred.promise as any);
    jest.spyOn(localLLMProfileService, 'getAllProfiles').mockImplementationOnce(() => profilesDeferred.promise as any);

    const firstLoadPromise = loadAuthenticatedRuntimeBootstrap('shared-token');
    const secondLoadPromise = loadAuthenticatedRuntimeBootstrap('shared-token');

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(localLLMProfileService.getAllProfiles).toHaveBeenCalledTimes(1);

    keysDeferred.resolve({
      data: [{ provider: 'openai', enabled: true, apiKey: 'secret' }],
    });
    profilesDeferred.resolve([
      { id: 'profile-1', name: 'Local profile', provider: 'ollama', endpoint: 'http://127.0.0.1:11434' },
    ]);

    const [firstState, secondState] = await Promise.all([firstLoadPromise, secondLoadPromise]);

    expect(firstState).toEqual(secondState);
    expect(firstState.llmApiKeys).toHaveLength(1);
    expect(firstState.localLLMProfiles).toHaveLength(1);
  });
});