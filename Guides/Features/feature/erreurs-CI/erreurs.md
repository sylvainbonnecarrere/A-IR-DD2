1- commande npm --prefix backend run build 
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

2- commande npm --prefix backend test -- --runInBand
    renvoie "PASS src/__tests__/user-tool-run.contract.test.ts
  UserToolRun domain contract
    ✓ accepts canonical execution statuses (1 ms)
    ✓ validates strict execution policy payloads (1 ms)
    ✓ rejects invalid execution policy payloads (1 ms)
    ✓ allows only declared transitions
    ✓ throws on forbidden transitions (4 ms)

  console.log
    ◇ injected env (0) from .env // tip: ◈ encrypted .env [www.dotenvx.com]

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS __tests__/agent-instance-egress-sanitizer.test.ts
  Agent instance egress sanitizer
    ✓ removes raw cloudStorageConfig from persistenceConfig responses (2 ms)

  console.log
    ◇ injected env (0) from .env // tip: ⌘ custom filepath { path: '/custom/path/.env' }

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/tool-readiness.service.test.ts
  ToolReadinessService
    ✓ marks a provisioned native tool as not_ready when the runtime is unavailable (1 ms)

  console.log
    ◇ injected env (0) from .env // tip: ⌁ auth for agents [www.vestauth.com]

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/task-instance.contract.test.ts
  TaskInstance domain contract
    ✓ accepts the canonical task statuses (1 ms)
    ✓ declares legal task transitions
    ✓ rejects illegal task transitions (2 ms)

  console.log
    ◇ injected env (0) from .env // tip: ⌁ auth for agents [www.vestauth.com]

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/application/workflows/__tests__/patchWorkflow.usecase.test.ts
  PatchWorkflowUseCase
    ✓ delegates partial workflow updates to the repository (1 ms)

  console.log
    ◇ injected env (0) from .env // tip: ⌘ override existing { override: true }

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/runtime-wrappers.test.ts
  runtimeWrappers
    ✓ produces a syntactically valid TypeScript wrapper for node --eval (1 ms)
    ✓ passes context and args to custom runtimes (1 ms)

  console.log
    ◇ injected env (0) from .env // tip: ⌘ custom filepath { path: '/custom/path/.env' }

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/user-tool-run-services.architecture.test.ts
  userTool run services architecture guard
    ✓ keeps run query and retention services independent from legacy FunctionService (2 ms)

  console.log
    ◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com]

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/tool-command-service.architecture.test.ts
  ToolCommandService architecture guard
    ✓ keeps canonical /api/tools commands independent from legacy FunctionService and UserFunction persistence (1 ms)

  console.log
    ◇ injected env (0) from .env // tip: ⌁ auth for agents [www.vestauth.com]

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/runtime-legacy-coupling.architecture.test.ts
  runtime legacy coupling architecture guard
    ✓ keeps sandbox and pythonExecutor free from user_tools mirror writes during execution (1 ms)

  console.log
    ◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com]

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/tool-read-adapter.architecture.test.ts
  ToolReadAdapterService architecture guard
    ✓ projects legacy function reads without depending on UserFunction persistence or FunctionService

  console.log
    ◇ injected env (0) from .env // tip: ◈ encrypted .env [www.dotenvx.com]

      at _log (node_modules/dotenv/lib/main.js:131:11)

PASS src/__tests__/webFetchService.test.ts
  WebFetchService (smoke)
    ✓ has a runFetch method

Summary of all failing tests
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
Error: Process completed with exit code 1"
