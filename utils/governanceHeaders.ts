import { useDesignStore } from '../stores/useDesignStore';

export const buildGovernanceHeaders = (
  accessToken?: string,
  extraHeaders: Record<string, string> = {}
): Record<string, string> => {
  const currentRobotId = useDesignStore.getState().currentRobotId;

  return {
    ...extraHeaders,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(currentRobotId ? { 'X-Robot-Id': currentRobotId } : {}),
  };
};