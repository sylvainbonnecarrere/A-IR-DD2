1- commande npm audit --audit-level=high 
    renvoie 9 vulnerabilities (2 moderate, 5 high, 2 critical)

2- commande npm --prefix backend audit --audit-level=high
    renvoie 13 vulnerabilities (4 moderate, 7 high, 2 critical)

3- commande Run npm --prefix backend run runtime:scan
    renvoie " npm --prefix backend run runtime:scan
  shell: /usr/bin/bash -e {0}

> llm-agent-workflow-backend@1.0.0 runtime:scan
> node scripts/runtime/scan-runtime.cjs --fail-on-severity=high

◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com]
Runtime scan: unhealthy
- [healthy] Docker CLI: Docker disponible (29.4.2)
- [healthy] Scanner local: Trivy détecté
- [unhealthy] Node.js runtime: CVE critical/high détectées via Trivy.
- [healthy] Python runtime: Aucune CVE critical/high détectée via Trivy.
- [healthy] Python provisioning image: Aucune CVE critical/high détectée via Trivy.
Error: Process completed with exit code 1."    

4- commande npm --prefix backend run build
    renvoie "Error: src/application/workflows/__tests__/createWorkflow.usecase.test.ts(7,9): error TS2322: Type '{ findByUserId: jest.Mock<any, any, any>; findById: jest.Mock<any, any, any>; create: jest.Mock<any, any, any>; update: jest.Mock<any, any, any>; delete: jest.Mock<...>; countByUserId: jest.Mock<...>; findFirstByUserId: jest.Mock<...>; }' is not assignable to type 'Mocked<IWorkflowRepository>'.
  Type '{ findByUserId: Mock<any, any, any>; findById: Mock<any, any, any>; create: Mock<any, any, any>; update: Mock<any, any, any>; delete: Mock<any, any, any>; countByUserId: Mock<...>; findFirstByUserId: Mock<...>; }' is missing the following properties from type '{ findByUserId: MockInstance<Promise<IWorkflow[]>, [userId: string], unknown>; findById: MockInstance<Promise<IWorkflow | null>, [workflowId: string], unknown>; ... 8 more ...; patchOwned: MockInstance<...>; }': findOwnedById, deactivateOthers, unsetDefaultForOthers, patchOwned
Error: src/application/workflows/__tests__/createWorkflow.usecase.test.ts(16,9): error TS2322: Type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' is not assignable to type 'Mocked<IUserRepository>'.
  Property 'setLastActiveWorkflow' is missing in type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' but required in type '{ findById: MockInstance<Promise<IUser | null>, [userId: string], unknown>; findByEmail: MockInstance<Promise<IUser | null>, [email: string], unknown>; setDefaultWorkflow: MockInstance<...>; setLastActiveWorkflow: MockInstance<...>; syncWorkflowCount: MockInstance<...>; getDefaultWorkflowId: MockInstance<...>; }'.
Error: src/application/workflows/__tests__/listUserWorkflows.usecase.test.ts(22,9): error TS2322: Type '{ findByUserId: jest.Mock<any, any, any>; findById: jest.Mock<any, any, any>; create: jest.Mock<any, any, any>; update: jest.Mock<any, any, any>; delete: jest.Mock<...>; countByUserId: jest.Mock<...>; findFirstByUserId: jest.Mock<...>; }' is not assignable to type 'Mocked<IWorkflowRepository>'.
  Type '{ findByUserId: Mock<any, any, any>; findById: Mock<any, any, any>; create: Mock<any, any, any>; update: Mock<any, any, any>; delete: Mock<any, any, any>; countByUserId: Mock<...>; findFirstByUserId: Mock<...>; }' is missing the following properties from type '{ findByUserId: MockInstance<Promise<IWorkflow[]>, [userId: string], unknown>; findById: MockInstance<Promise<IWorkflow | null>, [workflowId: string], unknown>; ... 8 more ...; patchOwned: MockInstance<...>; }': findOwnedById, deactivateOthers, unsetDefaultForOthers, patchOwned
Error: src/application/workflows/__tests__/listUserWorkflows.usecase.test.ts(31,9): error TS2322: Type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' is not assignable to type 'Mocked<IUserRepository>'.
  Property 'setLastActiveWorkflow' is missing in type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' but required in type '{ findById: MockInstance<Promise<IUser | null>, [userId: string], unknown>; findByEmail: MockInstance<Promise<IUser | null>, [email: string], unknown>; setDefaultWorkflow: MockInstance<...>; setLastActiveWorkflow: MockInstance<...>; syncWorkflowCount: MockInstance<...>; getDefaultWorkflowId: MockInstance<...>; }'.
Error: src/routes/runs.routes.ts(102,34): error TS2339: Property 'replayed' does not exist on type 'SandboxResult'.
Error: src/routes/workflows.routes.ts(483,45): error TS2339: Property '__v' does not exist on type 'IWorkflow'.
Error: src/routes/workflows.routes.ts(488,42): error TS2339: Property '__v' does not exist on type 'IWorkflow'.
Error: src/services/__tests__/WorkflowMigrationService.test.ts(14,7): error TS2741: Property 'setLastActiveWorkflow' is missing in type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' but required in type 'IUserRepository'.
Error: src/services/__tests__/WorkflowMigrationService.test.ts(22,7): error TS2739: Type '{ findByUserId: Mock<any, any, any>; findById: Mock<any, any, any>; create: Mock<any, any, any>; update: Mock<any, any, any>; delete: Mock<any, any, any>; countByUserId: Mock<...>; findFirstByUserId: Mock<...>; }' is missing the following properties from type 'IWorkflowRepository': findOwnedById, deactivateOthers, unsetDefaultForOthers, patchOwned
Error: src/websocket/WebSocketManager.ts(201,25): error TS2339: Property 'username' does not exist on type 'FlattenMaps<IUser> & Required<{ _id: ObjectId; }> & { __v: number; }'.
Error: src/websocket/WebSocketManager.ts(201,55): error TS2339: Property 'username' does not exist on type 'FlattenMaps<IUser> & Required<{ _id: ObjectId; }> & { __v: number; }'.
Error: src/websocket/WebSocketManager.ts(201,89): error TS2339: Property 'username' does not exist on type 'FlattenMaps<IUser> & Required<{ _id: ObjectId; }> & { __v: number; }'.
Error: Process completed with exit code 2."

5- commande npm --prefix backend run build
    renvoie "Error: src/__tests__/websocket-auth.test.ts(4,56): error TS2307: Cannot find module 'socket.io-client' or its corresponding type declarations.
Error: src/application/workflows/__tests__/createWorkflow.usecase.test.ts(7,9): error TS2322: Type '{ findByUserId: jest.Mock<any, any, any>; findById: jest.Mock<any, any, any>; create: jest.Mock<any, any, any>; update: jest.Mock<any, any, any>; delete: jest.Mock<...>; countByUserId: jest.Mock<...>; findFirstByUserId: jest.Mock<...>; }' is not assignable to type 'Mocked<IWorkflowRepository>'.
  Type '{ findByUserId: Mock<any, any, any>; findById: Mock<any, any, any>; create: Mock<any, any, any>; update: Mock<any, any, any>; delete: Mock<any, any, any>; countByUserId: Mock<...>; findFirstByUserId: Mock<...>; }' is missing the following properties from type '{ findByUserId: MockInstance<Promise<IWorkflow[]>, [userId: string], unknown>; findById: MockInstance<Promise<IWorkflow | null>, [workflowId: string], unknown>; ... 8 more ...; patchOwned: MockInstance<...>; }': findOwnedById, deactivateOthers, unsetDefaultForOthers, patchOwned
Error: src/application/workflows/__tests__/createWorkflow.usecase.test.ts(16,9): error TS2322: Type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' is not assignable to type 'Mocked<IUserRepository>'.
  Property 'setLastActiveWorkflow' is missing in type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' but required in type '{ findById: MockInstance<Promise<IUser | null>, [userId: string], unknown>; findByEmail: MockInstance<Promise<IUser | null>, [email: string], unknown>; setDefaultWorkflow: MockInstance<...>; setLastActiveWorkflow: MockInstance<...>; syncWorkflowCount: MockInstance<...>; getDefaultWorkflowId: MockInstance<...>; }'.
Error: src/application/workflows/__tests__/listUserWorkflows.usecase.test.ts(22,9): error TS2322: Type '{ findByUserId: jest.Mock<any, any, any>; findById: jest.Mock<any, any, any>; create: jest.Mock<any, any, any>; update: jest.Mock<any, any, any>; delete: jest.Mock<...>; countByUserId: jest.Mock<...>; findFirstByUserId: jest.Mock<...>; }' is not assignable to type 'Mocked<IWorkflowRepository>'.
  Type '{ findByUserId: Mock<any, any, any>; findById: Mock<any, any, any>; create: Mock<any, any, any>; update: Mock<any, any, any>; delete: Mock<any, any, any>; countByUserId: Mock<...>; findFirstByUserId: Mock<...>; }' is missing the following properties from type '{ findByUserId: MockInstance<Promise<IWorkflow[]>, [userId: string], unknown>; findById: MockInstance<Promise<IWorkflow | null>, [workflowId: string], unknown>; ... 8 more ...; patchOwned: MockInstance<...>; }': findOwnedById, deactivateOthers, unsetDefaultForOthers, patchOwned
Error: src/application/workflows/__tests__/listUserWorkflows.usecase.test.ts(31,9): error TS2322: Type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' is not assignable to type 'Mocked<IUserRepository>'.
  Property 'setLastActiveWorkflow' is missing in type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' but required in type '{ findById: MockInstance<Promise<IUser | null>, [userId: string], unknown>; findByEmail: MockInstance<Promise<IUser | null>, [email: string], unknown>; setDefaultWorkflow: MockInstance<...>; setLastActiveWorkflow: MockInstance<...>; syncWorkflowCount: MockInstance<...>; getDefaultWorkflowId: MockInstance<...>; }'.
Error: src/routes/runs.routes.ts(102,34): error TS2339: Property 'replayed' does not exist on type 'SandboxResult'.
Error: src/routes/workflows.routes.ts(483,45): error TS2339: Property '__v' does not exist on type 'IWorkflow'.
Error: src/routes/workflows.routes.ts(488,42): error TS2339: Property '__v' does not exist on type 'IWorkflow'.
Error: src/services/__tests__/WorkflowMigrationService.test.ts(14,7): error TS2741: Property 'setLastActiveWorkflow' is missing in type '{ findById: jest.Mock<any, any, any>; findByEmail: jest.Mock<any, any, any>; setDefaultWorkflow: jest.Mock<any, any, any>; syncWorkflowCount: jest.Mock<any, any, any>; getDefaultWorkflowId: jest.Mock<...>; }' but required in type 'IUserRepository'.
Error: src/services/__tests__/WorkflowMigrationService.test.ts(22,7): error TS2739: Type '{ findByUserId: Mock<any, any, any>; findById: Mock<any, any, any>; create: Mock<any, any, any>; update: Mock<any, any, any>; delete: Mock<any, any, any>; countByUserId: Mock<...>; findFirstByUserId: Mock<...>; }' is missing the following properties from type 'IWorkflowRepository': findOwnedById, deactivateOthers, unsetDefaultForOthers, patchOwned
Error: src/websocket/WebSocketManager.ts(201,25): error TS2339: Property 'username' does not exist on type 'FlattenMaps<IUser> & Required<{ _id: ObjectId; }> & { __v: number; }'.
Error: src/websocket/WebSocketManager.ts(201,55): error TS2339: Property 'username' does not exist on type 'FlattenMaps<IUser> & Required<{ _id: ObjectId; }> & { __v: number; }'.
Error: src/websocket/WebSocketManager.ts(201,89): error TS2339: Property 'username' does not exist on type 'FlattenMaps<IUser> & Required<{ _id: ObjectId; }> & { __v: number; }'.
Error: Process completed with exit code 2."

6- commande npm --prefix backend test -- --runInBand
    renvoie des erreurs de type "console.error
    [SandboxRoute] POST /run error: BuildPreparationError: Function must be prepared via the build workflow before sandbox execution.
        at Object.<anonymous> (/home/runner/work/A-IR-DD2/A-IR-DD2/backend/src/__tests__/sandbox.routes.test.ts:282:13)
        at processTicksAndRejections (node:internal/process/task_queues:104:5) {
      code: 'BUILD_PREPARATION_ERROR'"

    renvoie aussi le rapport "Summary of all failing tests
FAIL src/__tests__/websocket-auth.test.ts
  ● Test suite failed to run

    Cannot find module 'socket.io-client' from 'src/__tests__/websocket-auth.test.ts'

      2 | import { AddressInfo } from 'net';
      3 | import express from 'express';
    > 4 | import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
        | ^
      5 | import { WebSocketManager } from '../websocket/WebSocketManager';
      6 | import { User } from '../models/User.model';
      7 | import { Workflow } from '../models/Workflow.model';

      at Resolver._throwModNotFoundError (node_modules/jest-resolve/build/index.js:895:11)
      at Object.<anonymous> (src/__tests__/websocket-auth.test.ts:4:1)


Test Suites: 1 failed, 76 passed, 77 total
Tests:       358 passed, 358 total
Snapshots:   0 total
Time:        37.065 s
Ran all test suites.
Error: Process completed with exit code 1."  