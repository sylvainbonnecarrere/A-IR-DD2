# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: WorkflowCanvas.route-reentry.semi-e2e.spec.ts >> les nodes gardent la meme position apres navigation vers un autre ecran et retour sur la carte
- Location: tests\fonctionnels\WorkflowCanvas.route-reentry.semi-e2e.spec.ts:125:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "DIV.react-flow:137",
+ ]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - img [ref=e5]:
      - generic [ref=e9]: IR-DD2
    - generic [ref=e10]:
      - button "Paramètres" [ref=e11] [cursor=pointer]
      - generic [ref=e16]:
        - generic [ref=e17]: reentry@test.local
        - button "Déconnexion" [ref=e18] [cursor=pointer]
  - generic [ref=e19]:
    - complementary [ref=e20]:
      - button "Archi" [ref=e22] [cursor=pointer]
      - button "Bos" [ref=e27] [cursor=pointer]
      - button "Com" [ref=e36] [cursor=pointer]
      - button "Phil" [ref=e43] [cursor=pointer]
      - button "Tim" [ref=e48] [cursor=pointer]
    - main [ref=e52]:
      - generic [ref=e53]:
        - generic [ref=e54]:
          - generic [ref=e55]:
            - heading "Dashboard - Carte des Workflows" [level=1] [ref=e56]
            - paragraph [ref=e57]: Vue d'ensemble cartographique de tous les workflows et leur statut
          - button "Gestion des fichiers" [ref=e59] [cursor=pointer]
        - generic [ref=e62]:
          - generic [ref=e64]:
            - generic:
              - generic:
                - button [ref=e65]:
                  - generic [ref=e66]:
                    - generic [ref=e71]:
                      - heading "Agent a" [level=3] [ref=e75]
                      - generic [ref=e76]:
                        - button "Réduire" [ref=e77] [cursor=pointer]
                        - button "Configurer l'instance" [ref=e79] [cursor=pointer]
                        - button "Ouvrir en plein écran" [ref=e83] [cursor=pointer]
                        - button "Supprimer définitivement" [ref=e86] [cursor=pointer]
                    - generic [ref=e91]:
                      - generic [ref=e92]: Gemini ÔÇó gemini-2.0-flash
                      - generic [ref=e94]:
                        - generic [ref=e95]: Message 0 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e98]: Message 1 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e101]: Message 2 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e104]: Message 3 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e107]: Message 4 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e110]: Message 5 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e113]: Message 6 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e116]: Message 7 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e119]: Message 8 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e122]: Message 9 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e125]: Message 10 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e128]: Message 11 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e131]: Message 12 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e134]: Message 13 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e137]: Message 14 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e140]: Message 15 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e143]: Message 16 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e146]: Message 17 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e149]: Message 18 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e152]: Message 19 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e155]: Message 20 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e158]: Message 21 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e161]: Message 22 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e164]: Message 23 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e167]: Message 24 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e170]: Message 25 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e173]: Message 26 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e176]: Message 27 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e179]: Message 28 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e182]: Message 29 long long long long long long long long long long long long long long long long long long long long
                      - generic [ref=e187]:
                        - textbox "Tapez votre message..." [ref=e189]
                        - button [disabled] [ref=e191]
                - button [ref=e195]:
                  - generic [ref=e196]:
                    - generic [ref=e201]:
                      - heading "Agent b" [level=3] [ref=e205]
                      - generic [ref=e206]:
                        - button "Réduire" [ref=e207] [cursor=pointer]
                        - button "Configurer l'instance" [ref=e209] [cursor=pointer]
                        - button "Ouvrir en plein écran" [ref=e213] [cursor=pointer]
                        - button "Supprimer définitivement" [ref=e216] [cursor=pointer]
                    - generic [ref=e221]:
                      - generic [ref=e222]: Gemini ÔÇó gemini-2.0-flash
                      - generic [ref=e224]:
                        - generic [ref=e225]: Message 0 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e228]: Message 1 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e231]: Message 2 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e234]: Message 3 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e237]: Message 4 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e240]: Message 5 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e243]: Message 6 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e246]: Message 7 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e249]: Message 8 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e252]: Message 9 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e255]: Message 10 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e258]: Message 11 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e261]: Message 12 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e264]: Message 13 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e267]: Message 14 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e270]: Message 15 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e273]: Message 16 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e276]: Message 17 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e279]: Message 18 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e282]: Message 19 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e285]: Message 20 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e288]: Message 21 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e291]: Message 22 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e294]: Message 23 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e297]: Message 24 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e300]: Message 25 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e303]: Message 26 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e306]: Message 27 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e309]: Message 28 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e312]: Message 29 long long long long long long long long long long long long long long long long long long long long
                      - generic [ref=e317]:
                        - textbox "Tapez votre message..." [ref=e319]
                        - button [disabled] [ref=e321]
                - button [ref=e325]:
                  - generic [ref=e326]:
                    - generic [ref=e331]:
                      - heading "Agent c" [level=3] [ref=e335]
                      - generic [ref=e336]:
                        - button "Réduire" [ref=e337] [cursor=pointer]
                        - button "Configurer l'instance" [ref=e339] [cursor=pointer]
                        - button "Ouvrir en plein écran" [ref=e343] [cursor=pointer]
                        - button "Supprimer définitivement" [ref=e346] [cursor=pointer]
                    - generic [ref=e351]:
                      - generic [ref=e352]: Gemini ÔÇó gemini-2.0-flash
                      - generic [ref=e354]:
                        - generic [ref=e355]: Message 0 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e358]: Message 1 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e361]: Message 2 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e364]: Message 3 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e367]: Message 4 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e370]: Message 5 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e373]: Message 6 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e376]: Message 7 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e379]: Message 8 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e382]: Message 9 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e385]: Message 10 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e388]: Message 11 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e391]: Message 12 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e394]: Message 13 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e397]: Message 14 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e400]: Message 15 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e403]: Message 16 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e406]: Message 17 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e409]: Message 18 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e412]: Message 19 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e415]: Message 20 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e418]: Message 21 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e421]: Message 22 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e424]: Message 23 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e427]: Message 24 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e430]: Message 25 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e433]: Message 26 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e436]: Message 27 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e439]: Message 28 long long long long long long long long long long long long long long long long long long long long
                        - generic [ref=e442]: Message 29 long long long long long long long long long long long long long long long long long long long long
                      - generic [ref=e447]:
                        - textbox "Tapez votre message..." [ref=e449]
                        - button [disabled] [ref=e451]
          - generic [ref=e455]:
            - button "zoom in" [ref=e456] [cursor=pointer]
            - button "zoom out" [ref=e459] [cursor=pointer]
            - button "fit view" [ref=e462] [cursor=pointer]
            - button "toggle interactivity" [ref=e465] [cursor=pointer]
          - img "React Flow mini map" [ref=e469]
          - button "Save prototype workflow" [ref=e474] [cursor=pointer]: S
```

# Test source

```ts
  34  |             role: 'assistant',
  35  |             model: 'gemini-2.0-flash',
  36  |             llmProvider: 'gemini',
  37  |             systemPrompt: 'x',
  38  |             capabilities: [],
  39  |             tools: [],
  40  |             toolSelections: [],
  41  |             historyConfig: {},
  42  |             outputConfig: {},
  43  |             position,
  44  |         },
  45  |     };
  46  | });
  47  | 
  48  | const workspacePayload = {
  49  |     workflow: {
  50  |         id: workflowId,
  51  |         _id: workflowId,
  52  |         name: 'Workflow reentry',
  53  |         isActive: true,
  54  |         isDefault: true,
  55  |         isDirty: false,
  56  |         canvasState: { zoom: 1, panX: 0, panY: 0 },
  57  |         createdAt: now,
  58  |         updatedAt: now,
  59  |     },
  60  |     nodes: [],
  61  |     edges: [],
  62  |     agentInstances: instances,
  63  |     agentPrototypes: prototypes,
  64  |     llmConfigs: [],
  65  |     toolRuns: [],
  66  |     metadata: { userId: 'user-reentry', source: 'api', loadedAt: now, hasWorkflow: true },
  67  | };
  68  | 
  69  | const fulfillJson = (route: Route, status: number, body: unknown) => route.fulfill({
  70  |     status,
  71  |     contentType: 'application/json',
  72  |     body: JSON.stringify(body),
  73  |     headers: { 'access-control-allow-origin': '*' },
  74  | });
  75  | 
  76  | async function installMocks(page: Page) {
  77  |     await page.addInitScript(() => {
  78  |         localStorage.setItem('auth_data_v1', JSON.stringify({
  79  |             user: { id: 'user-reentry', email: 'reentry@test.local', role: 'user' },
  80  |             accessToken: 'token',
  81  |             refreshToken: 'refresh',
  82  |         }));
  83  |     });
  84  | 
  85  |     await page.route('**/api/**', async (route) => {
  86  |         const { pathname } = new URL(route.request().url());
  87  |         const method = route.request().method();
  88  |         if (pathname === '/api/user/workspace' && method === 'GET') return fulfillJson(route, 200, workspacePayload);
  89  |         if (pathname === '/api/workflows' && method === 'GET') {
  90  |             return fulfillJson(route, 200, {
  91  |                 workflows: [{ _id: workflowId, userId: 'user-reentry', name: 'Workflow reentry', isActive: true, isDefault: true, createdAt: now, updatedAt: now }],
  92  |             });
  93  |         }
  94  |         if (pathname === '/api/llm/get-all-api-keys') return fulfillJson(route, 200, []);
  95  |         if (pathname === '/api/local-llm-profiles') return fulfillJson(route, 200, []);
  96  |         if (pathname === '/api/tools') return fulfillJson(route, 200, { items: [] });
  97  |         return fulfillJson(route, 200, {});
  98  |     });
  99  | }
  100 | 
  101 | async function snapshot(page: Page) {
  102 |     return page.evaluate(() => {
  103 |         const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  104 |         const nodes = Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
  105 |             const rect = el.getBoundingClientRect();
  106 |             return { id: el.getAttribute('data-id'), x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) };
  107 |         });
  108 |         const rectOf = (selector: string) => {
  109 |             const rect = document.querySelector(selector)?.getBoundingClientRect();
  110 |             return rect ? { x: Math.round(rect.x), y: Math.round(rect.y) } : null;
  111 |         };
  112 |         const scrolled = Array.from(document.querySelectorAll('*'))
  113 |             .filter((el) => (el as HTMLElement).scrollTop > 0 && !(el as HTMLElement).className?.toString().includes('overflow-y-auto'))
  114 |             .map((el) => `${el.tagName}.${(el as HTMLElement).className?.toString().slice(0, 40)}:${(el as HTMLElement).scrollTop}`);
  115 |         return {
  116 |             transform: viewport?.style.transform ?? null,
  117 |             nodes,
  118 |             minimap: rectOf('.workflow-minimap-fixed'),
  119 |             controls: rectOf('.workflow-controls-fixed'),
  120 |             scrolled,
  121 |         };
  122 |     });
  123 | }
  124 | 
  125 | test('les nodes gardent la meme position apres navigation vers un autre ecran et retour sur la carte', async ({ page }) => {
  126 |     await installMocks(page);
  127 |     page.on('console', (msg) => { if (msg.text().includes('DBGFIT')) console.log(msg.text()); });
  128 |     await page.goto('/');
  129 |     await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
  130 |     await page.waitForTimeout(1500);
  131 |     const before = await snapshot(page);
  132 |     console.log('BEFORE', JSON.stringify(before));
  133 |     expect(before.nodes.length).toBe(3);
> 134 |     expect(before.scrolled).toEqual([]);
      |                             ^ Error: expect(received).toEqual(expected) // deep equality
  135 | 
  136 |     for (let i = 0; i < 2; i += 1) {
  137 |         await page.getByRole('button', { name: 'Phil' }).click();
  138 |         await page.getByRole('button', { name: 'Fonctions Personnalisées' }).click();
  139 |         await page.waitForTimeout(800);
  140 |         await page.getByRole('button', { name: 'Bos' }).click();
  141 |         await page.getByRole('button', { name: 'Carte du workflow' }).click();
  142 |         await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
  143 |         await page.waitForTimeout(1500);
  144 |         const after = await snapshot(page);
  145 |         console.log(`AFTER${i}`, JSON.stringify(after));
  146 |         expect(after.nodes).toEqual(before.nodes);
  147 |         expect(after.minimap).toEqual(before.minimap);
  148 |         expect(after.controls).toEqual(before.controls);
  149 |         expect(after.scrolled).toEqual([]);
  150 |         expect(after.transform).toBe(before.transform);
  151 |     }
  152 | });
  153 | 
```