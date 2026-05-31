import { executeTool } from '../../utils/toolExecutor';

describe('toolExecutor', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails closed for python tools without calling the removed legacy backend endpoint', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as typeof fetch;

    const result = await executeTool({
      id: 'tool-call-1',
      name: 'read_py',
      arguments: JSON.stringify({ file_path: 'docs/readme.md' }),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      error: expect.stringContaining('read_py'),
      sandboxRequired: true,
      legacyRouteRemoved: true,
      toolName: 'read_py',
    }));
  });

  it('keeps local built-in tools available', async () => {
    const result = await executeTool({
      id: 'tool-call-2',
      name: 'get_weather',
      arguments: JSON.stringify({ location: 'Paris' }),
    });

    expect(result).toEqual({
      location: 'Paris',
      temperature: '22°C',
      condition: 'Sunny',
    });
  });
});