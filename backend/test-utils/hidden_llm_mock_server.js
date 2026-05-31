const http = require('http');
const { URL } = require('url');

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function startMockServer(options = {}) {
  const port = options.port || 0; // 0 => ephemeral

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Only accept POST to the expected test path
    if (req.method === 'POST' && url.pathname === '/api/web-search/hidden-llm/complete') {
      try {
        const body = await parseJsonBody(req);
        const scenario = (body && body.scenario) || (options.defaultScenario) || 'success';
        if (scenario === 'slow') {
          const delayMs = (body && body.delayMs) || 5000;
          await new Promise((r) => setTimeout(r, delayMs));
          const text = body.transformed || 'météo demain Paris';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text }));
          return;
        }
        if (scenario === 'error') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Simulated hidden-llm error' }));
          return;
        }

        // default: success
        const text = (body && body.transformed) || 'météo demain Paris';
        const response = { text };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json', message: err.message }));
      }
      return;
    }

    // health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = addr && addr.port;
      resolve({
        server,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        close: () => new Promise((resClose) => server.close(resClose)),
      });
    });
    server.on('error', reject);
  });
}

module.exports = { startMockServer };
