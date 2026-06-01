type RoutePrefix = `/${string}`;

export const ROBOT_PAGE_ROUTE_IDS = {
  archi: 'archi',
  bosDashboard: 'bos-dashboard',
  bosSupervision: 'bos-supervision',
  bosWorkflowManagement: 'bos-workflow-management',
  comApi: 'com-api',
  comDatabases: 'com-databases',
  philData: 'phil-data',
  philFunctions: 'phil-functions',
  timEvents: 'tim-events',
  fallback: 'fallback',
} as const;

export type RobotPageRouteId = typeof ROBOT_PAGE_ROUTE_IDS[keyof typeof ROBOT_PAGE_ROUTE_IDS];

type RobotPageRouteDefinition = {
  id: RobotPageRouteId;
  prefixes: readonly RoutePrefix[];
};

const ROBOT_PAGE_ROUTE_DEFINITIONS: readonly RobotPageRouteDefinition[] = [
  {
    id: ROBOT_PAGE_ROUTE_IDS.bosWorkflowManagement,
    prefixes: ['/bos/workflows/manage'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.bosDashboard,
    prefixes: ['/bos/dashboard'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.bosSupervision,
    prefixes: ['/bos/monitoring', '/bos/analytics', '/bos/governance', '/bos/playground', '/bos'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.comDatabases,
    prefixes: ['/com/databases'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.philFunctions,
    prefixes: ['/phil/functions'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.archi,
    prefixes: ['/archi/prototype', '/archi/instanciation', '/archi/links', '/archi/tasks', '/archi/library', '/archi'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.comApi,
    prefixes: ['/com/connections', '/com/connexions-api', '/com/vector-db', '/com/mcp', '/com/hub', '/com'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.philData,
    prefixes: ['/phil/rag', '/phil/files', '/phil/libraries', '/phil/knowledge', '/phil'],
  },
  {
    id: ROBOT_PAGE_ROUTE_IDS.timEvents,
    prefixes: ['/tim/triggers', '/tim/scheduling', '/tim/polling', '/tim/rate-limiting', '/tim/async', '/tim'],
  },
] as const;

function normalizeRoutePath(path: string): string {
  const pathWithoutQuery = path.split('?')[0]?.split('#')[0] ?? '';
  if (!pathWithoutQuery) {
    return '/';
  }

  if (pathWithoutQuery.length > 1 && pathWithoutQuery.endsWith('/')) {
    return pathWithoutQuery.slice(0, -1);
  }

  return pathWithoutQuery;
}

function matchesRoutePrefix(currentPath: string, prefix: RoutePrefix): boolean {
  const normalizedCurrentPath = normalizeRoutePath(currentPath);
  const normalizedPrefix = normalizeRoutePath(prefix);

  return normalizedCurrentPath === normalizedPrefix || normalizedCurrentPath.startsWith(`${normalizedPrefix}/`);
}

export function resolveRobotPageRoute(currentPath: string): RobotPageRouteId {
  const matchingRoute = ROBOT_PAGE_ROUTE_DEFINITIONS.find((route) =>
    route.prefixes.some((prefix) => matchesRoutePrefix(currentPath, prefix)),
  );

  return matchingRoute?.id ?? ROBOT_PAGE_ROUTE_IDS.fallback;
}