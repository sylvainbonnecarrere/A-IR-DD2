#!/usr/bin/env node
const { startMockServer } = require('../test-utils/hidden_llm_mock_server');

const argv = require('minimist')(process.argv.slice(2));
const port = argv.port ? Number(argv.port) : 0;
const defaultScenario = argv.scenario || 'success';

(async () => {
  try {
    const server = await startMockServer({ port, defaultScenario });
    console.log(`Hidden-LLM mock server running at ${server.url}`);
    console.log('Endpoints: POST /api/web-search/hidden-llm/complete  GET /health');
    console.log('Use JSON body {"scenario":"success|slow|error","transformed":"...","delayMs":5000}');
    // keep running until SIGINT
    process.on('SIGINT', async () => {
      console.log('Shutting down mock server...');
      await server.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to start mock server', err);
    process.exit(1);
  }
})();
