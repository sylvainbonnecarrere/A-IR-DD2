1- commande  npm --prefix backend run build
    renvoie "
rror: src/__tests__/worker-lease.service.test.ts(32,16): error TS18048: 'second.lease' is possibly 'undefined'.
Error: src/__tests__/workflow-validator.test.ts(102,46): error TS2345: Argument of type '{ valid: boolean; issues: { code: string; message: string; details: { instanceId: string; }; }[]; }' is not assignable to parameter of type 'WorkflowValidationResult'.
  Types of property 'issues' are incompatible.
    Type '{ code: string; message: string; details: { instanceId: string; }; }[]' is not assignable to type 'WorkflowValidationIssue[]'.
      Type '{ code: string; message: string; details: { instanceId: string; }; }' is not assignable to type 'WorkflowValidationIssue'.
        Types of property 'code' are incompatible.
          Type 'string' is not assignable to type 'WorkflowValidationIssueCode'.
Error: src/domain/execution/runtimeEvent.contract.ts(96,4): error TS2554: Expected 2-3 arguments, but got 1.
Error: src/migrations/008_workflow_v1_to_v2_migration.ts(132,28): error TS2339: Property 'sourceHandle' does not exist on type 'LegacyWorkflowEdgeLike'.
Error: src/migrations/008_workflow_v1_to_v2_migration.ts(133,28): error TS2339: Property 'targetHandle' does not exist on type 'LegacyWorkflowEdgeLike'.
Error: Process completed with exit code 2."

2- commande  npm --prefix backend run build
    renvoie "Error: src/__tests__/worker-lease.service.test.ts(32,16): error TS18048: 'second.lease' is possibly 'undefined'.
Error: src/__tests__/workflow-validator.test.ts(102,46): error TS2345: Argument of type '{ valid: boolean; issues: { code: string; message: string; details: { instanceId: string; }; }[]; }' is not assignable to parameter of type 'WorkflowValidationResult'.
  Types of property 'issues' are incompatible.
    Type '{ code: string; message: string; details: { instanceId: string; }; }[]' is not assignable to type 'WorkflowValidationIssue[]'.
      Type '{ code: string; message: string; details: { instanceId: string; }; }' is not assignable to type 'WorkflowValidationIssue'.
        Types of property 'code' are incompatible.
          Type 'string' is not assignable to type 'WorkflowValidationIssueCode'.
Error: src/domain/execution/runtimeEvent.contract.ts(96,4): error TS2554: Expected 2-3 arguments, but got 1.
Error: src/migrations/008_workflow_v1_to_v2_migration.ts(132,28): error TS2339: Property 'sourceHandle' does not exist on type 'LegacyWorkflowEdgeLike'.
Error: src/migrations/008_workflow_v1_to_v2_migration.ts(133,28): error TS2339: Property 'targetHandle' does not exist on type 'LegacyWorkflowEdgeLike'.
Error: Process completed with exit code 2."
