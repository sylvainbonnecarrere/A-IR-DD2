import { logger } from '../services/logger';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../middleware/auth.middleware', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: { id: '507f1f77bcf86cd799439011' } });
    next();
  },
}));

import sandboxRoutes from '../routes/sandbox.routes';
import { RunCompletionTimeoutError } from '../services/runtime/ExecutionOrchestrator';
import { SandboxService } from '../services/sandbox.service';

describe('sandbox durable run acknowledgement', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns HTTP 202 and the run status URL when synchronous waiting times out', async () => {
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(SandboxService.prototype, 'runFunction').mockRejectedValue(new RunCompletionTimeoutError('execution-123'));
    const app = express();
    app.use(express.json());
    app.use('/api/sandbox', sandboxRoutes);

    const response = await request(app).post('/api/sandbox/run').send({ functionId: '507f1f77bcf86cd799439012', testArgs: {} });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      executionId: 'execution-123',
      status: 'accepted',
      statusUrl: '/api/runs/executions/execution-123',
    });
    expect(errorLog).toHaveBeenCalledWith(
      '[SandboxRoute] POST /run error:',
      expect.objectContaining({ name: 'RunCompletionTimeoutError' }),
    );
  });
});
