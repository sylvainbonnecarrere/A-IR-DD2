Hidden LLM mock server for tests

Usage (quick):

- Start the mock (ephemeral port):
  node backend/scripts/run-hidden-llm-mock.js

- Start on a fixed port and simulate slow responses:
  node backend/scripts/run-hidden-llm-mock.js --port 3001 --scenario slow

Request format (POST /api/web-search/hidden-llm/complete):
- JSON body options:
  - `scenario`: "success" | "slow" | "error" (optional)
  - `transformed`: string to return as `text` (optional)
  - `delayMs`: for `slow` scenario, delay in ms (optional)

The test harness can point `private_context.web_search.llm_runtime.completion_api_url` to
`http://127.0.0.1:<port>/api/web-search/hidden-llm/complete` for deterministic QA.
