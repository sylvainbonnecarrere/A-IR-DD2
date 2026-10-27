export interface IAgentInstanceRepository {
  countByWorkflowIds(workflowIds: string[]): Promise<Record<string, number>>;
}