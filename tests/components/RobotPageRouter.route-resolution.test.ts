import { resolveRobotPageRoute } from '../../utils/robotPageRouting';

describe('resolveRobotPageRoute', () => {
  it('distinguishes the BOS dashboard from the other BOS supervision routes', () => {
    expect(resolveRobotPageRoute('/bos/dashboard')).toBe('bos-dashboard');
    expect(resolveRobotPageRoute('/bos/monitoring')).toBe('bos-supervision');
  });

  it('prefers the explicit BOS workflow management route over the generic BOS workflow route', () => {
    expect(resolveRobotPageRoute('/bos/workflows/manage')).toBe('bos-workflow-management');
    expect(resolveRobotPageRoute('/bos/workflows/manage/details')).toBe('bos-workflow-management');
  });

  it('supports both canonical and legacy COM API paths', () => {
    expect(resolveRobotPageRoute('/com/connections')).toBe('com-api');
    expect(resolveRobotPageRoute('/com/connexions-api')).toBe('com-api');
    expect(resolveRobotPageRoute('/com/mcp')).toBe('com-api');
  });

  it('distinguishes Phil functions from the generic Phil data routes', () => {
    expect(resolveRobotPageRoute('/phil/functions')).toBe('phil-functions');
    expect(resolveRobotPageRoute('/phil/files')).toBe('phil-data');
  });

  it('normalizes trailing slashes and falls back for unknown paths', () => {
    expect(resolveRobotPageRoute('/tim/triggers/')).toBe('tim-events');
    expect(resolveRobotPageRoute('/unknown/path')).toBe('fallback');
  });
});