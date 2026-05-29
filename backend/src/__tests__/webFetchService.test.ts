import WebFetchService from '../services/webFetchService';

describe('WebFetchService (smoke)', () => {
  it('has a runFetch method', async () => {
    const svc = new WebFetchService();
    expect(typeof svc.runFetch).toBe('function');
  });
});
