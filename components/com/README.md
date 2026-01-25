# 🔌 Composants COM - Guide Technique

Bienvenue dans la suite de composants réutilisables du robot **COM** (Connectivité). Cette directory contient des composants génériques pour afficher et gérer des connexions (APIs et bases de données).

## 📦 Contenu

### 1. **ConnectionListItem.tsx**
Composant pour afficher un item de connexion (API ou base de données).

#### Import
```tsx
import { ConnectionListItem, IConnectionItem } from '../com';
```

#### Usage (API)
```tsx
<ConnectionListItem
  item={{
    id: '1',
    name: 'Get Users',
    method: 'GET',
    url: 'https://api.example.com/users',
    status: 'tested',
    format: 'JSON',
    lastTestDate: '2024-01-23'
  }}
  isSelected={selectedId === '1'}
  onSelect={() => setSelectedId('1')}
  onEdit={() => handleEdit('1')}
  onDelete={() => handleDelete('1')}
  onAddToWorkflow={() => handleWorkflow('1')}
  type="api"
/>
```

#### Usage (Database)
```tsx
<ConnectionListItem
  item={{
    id: '1',
    name: 'Prod DB',
    provider: 'PostgreSQL',
    host: 'prod.example.com',
    status: 'connected'
  }}
  isSelected={selectedId === '1'}
  onSelect={() => setSelectedId('1')}
  onEdit={() => handleEdit('1')}
  onDelete={() => handleDelete('1')}
  onAddToWorkflow={() => handleWorkflow('1')}
  type="database"
/>
```

#### Props Interface
```typescript
interface ConnectionListItemProps {
  item: IConnectionItem;           // Données connexion
  isSelected: boolean;              // État sélectionné
  onSelect: () => void;             // Clic item
  onEdit: () => void;               // Clic crayon
  onDelete: () => void;             // Clic poubelle
  onAddToWorkflow?: () => void;     // Clic footer (optionnel)
  type: 'api' | 'database';        // Mode affichage
}
```

#### Data Interface
```typescript
interface IConnectionItem {
  id: string;
  name: string;
  method?: string;         // GET, POST, etc (API)
  url?: string;            // https://... (API)
  provider?: string;       // PostgreSQL, Redis, etc (DB)
  host?: string;           // Host address (DB)
  status?: 'connected' | 'disconnected' | 'testing' | 'tested' | 'error';
  lastTestDate?: string;   // ISO date string
  format?: string;         // JSON, CSV, etc (API)
}
```

#### Rendering
- **Header**: Nom + Boutons Edit/Delete
- **Body**: Info spécifique (Méthode+URL pour API, Provider+Host pour DB)
- **Status**: Indicateur visuel avec date
- **Footer**: Bouton "Ajouter au workflow" (si `onAddToWorkflow` fourni)

---

### 2. **ResultViewer.tsx**
Composant pour afficher des résultats de requête (JSON/XML/CSV/Raw).

#### Import
```tsx
import { ResultViewer } from '../com';
```

#### Usage
```tsx
<ResultViewer
  data={[
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' }
  ]}
  status={200}
  statusText="OK"
  time={245}
  size="1.2"
  format="json"
/>
```

#### Props Interface
```typescript
interface ResultViewerProps {
  data: any;                                      // Données à afficher
  status?: number;                                // HTTP status code
  statusText?: string;                            // "OK", "Not Found"
  time?: number;                                  // Durée en ms
  size?: string;                                  // Taille en KB
  format?: 'json' | 'xml' | 'csv' | 'raw';      // Format données
  isLoading?: boolean;                            // État loading
}
```

#### Modes Visualisation

**🌳 Tree View** (Défaut)
- Navigation interactive JSON
- Chevron > pour expand/collapse
- Sélection valeurs pour drag & drop
- Limité à 10 clés + "... et N autres"

**📊 Table View**
- Auto-généré si array de objects
- Colonnes depuis keys
- Rows scrollables
- Valeurs troncées

**💾 Raw View**
- JSON pretty-printed
- Monospace font
- Full text, line breaks preserved

#### Header Features
- Status badge: 🟢 2xx | 🟡 4xx | 🔴 5xx
- Timing & Size: "245ms • 1.2 KB"
- Tab buttons pour switcher modes

---

### 3. **DatabaseExplorer.tsx**
Composant pour explorer et interroger une base de données.

#### Import
```tsx
import { DatabaseExplorer } from '../com';
```

#### Usage
```tsx
<DatabaseExplorer
  databaseName="Prod Users DB"
  provider="PostgreSQL"
  host="prod.example.com"
  status="connected"
  tables={['users', 'orders', 'products']}
  onExecuteQuery={(query) => console.log('Query:', query)}
  onRefresh={() => console.log('Refresh clicked')}
/>
```

#### Props Interface
```typescript
interface DatabaseExplorerProps {
  databaseName: string;
  provider: string;
  host: string;
  status: 'connected' | 'disconnected' | 'testing';
  tables?: string[];
  isLoading?: boolean;
  onExecuteQuery?: (query: string) => void;
  onRefresh?: () => void;
}
```

#### Layout
```
┌─ Info Header ──────────────────┐
│ Nom • Provider • Status        │
│ [Refresh Button]               │
└────────────────────────────────┘

┌─ Split View ─────────────────────┐
│ Tables (L)  │  Editor+Results(R) │
├─────────────┼───────────────────
│ • users     │ [SQL|JSON] [Exec]
│ • orders    │ [Textarea Query]
│ • products  │ [Results Table]
└─────────────┴───────────────────┘
```

#### Features
- Tables list avec hover effect
- Query editor: SQL (défaut) ou JSON
- Execute button avec spinner
- Results table avec pagination
- Status indicator: 🟢 Connected / 🔴 Disconnected

---

## 🎨 Styling

Tous les composants utilisent **Tailwind CSS** avec la **palette COM (Vert)**:

```tsx
// Primary
from-green-600 to-emerald-600
bg-green-600
text-green-400

// Hover
hover:from-green-500 hover:to-emerald-500
hover:bg-gray-600

// Active
bg-green-600/20
border-green-500

// Shadows
shadow-lg shadow-green-500/50
```

---

## 🔄 Patterns d'Intégration

### Pattern 1: Avec Notifications
```tsx
import { useNotifications } from '../../contexts/NotificationContext';

const { addNotification } = useNotifications();

const handleDelete = (id: string) => {
  setItems(items.filter(i => i.id !== id));
  addNotification({
    type: 'success',
    title: '✅ Supprimé',
    message: 'Connexion supprimée',
    duration: 3000
  });
};
```

### Pattern 2: Avec Modals
```tsx
const [showModal, setShowModal] = useState(false);
const [selectedItem, setSelectedItem] = useState<IConnectionItem | null>(null);

return (
  <>
    <ConnectionListItem
      item={item}
      onAddToWorkflow={() => {
        setSelectedItem(item);
        setShowModal(true);
      }}
      type="api"
    />

    {showModal && (
      <Modal title="Ajouter au Workflow">
        {/* Modal content */}
      </Modal>
    )}
  </>
);
```

### Pattern 3: Avec Forms
```tsx
const [connections, setConnections] = useState<IConnectionItem[]>([]);
const [form, setForm] = useState<IConnectionItem>({...});

<ConnectionListItem
  item={connection}
  onEdit={() => {
    setForm(connection);
    setShowForm(true);
  }}
  type="api"
/>
```

---

## 📚 Exemples Complets

### ComApiPage.tsx
```tsx
import { ConnectionListItem, ResultViewer } from '../com';

export const ComApiPage: React.FC = () => {
  const [connections, setConnections] = useState<ApiConnection[]>([...]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);

  return (
    <div className="flex">
      {/* Col 1 */}
      <div className="w-72">
        {connections.map(conn => (
          <ConnectionListItem
            key={conn.id}
            item={conn}
            isSelected={selectedId === conn.id}
            onSelect={() => setSelectedId(conn.id)}
            onEdit={() => handleEdit(conn.id)}
            onDelete={() => handleDelete(conn.id)}
            onAddToWorkflow={() => handleWorkflow(conn.id)}
            type="api"
          />
        ))}
      </div>

      {/* Col 3 */}
      <div className="flex-1">
        {response && (
          <ResultViewer
            data={response.data}
            status={response.status}
            statusText={response.statusText}
            time={response.time}
            size={response.size}
          />
        )}
      </div>
    </div>
  );
};
```

### ComDatabasesPage.tsx
```tsx
import { ConnectionListItem, DatabaseExplorer } from '../com';

export const ComDatabasesPage: React.FC = () => {
  const [databases, setDatabases] = useState<DatabaseNode[]>([...]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex">
      {/* Col 1 */}
      <div className="w-72">
        {databases.map(db => (
          <ConnectionListItem
            key={db.id}
            item={db}
            isSelected={selectedId === db.id}
            onSelect={() => setSelectedId(db.id)}
            onEdit={() => handleEdit(db.id)}
            onDelete={() => handleDelete(db.id)}
            onAddToWorkflow={() => handleWorkflow(db.id)}
            type="database"
          />
        ))}
      </div>

      {/* Col 2 */}
      <div className="flex-1">
        {selectedId && (
          <DatabaseExplorer
            databaseName={db.name}
            provider={db.provider}
            host={db.host}
            status={db.status}
            onExecuteQuery={(query) => console.log(query)}
          />
        )}
      </div>
    </div>
  );
};
```

---

## 🧪 Testing

### Unit Tests
```typescript
describe('ConnectionListItem', () => {
  it('should render API connection with method badge', () => {
    render(
      <ConnectionListItem
        item={{ id: '1', name: 'Test', method: 'GET', type: 'api' }}
        type="api"
        {...props}
      />
    );
    expect(screen.getByText('GET')).toBeInTheDocument();
  });
});

describe('ResultViewer', () => {
  it('should toggle tree node on chevron click', () => {
    const { getByRole } = render(
      <ResultViewer data={{ users: [{ id: 1 }] }} />
    );
    // Test tree expansion
  });
});
```

---

## 🔗 Index & Exports

Le fichier `index.ts` centralise tous les exports:

```typescript
// components/com/index.ts
export { ConnectionListItem } from './ConnectionListItem';
export type { IConnectionItem } from './ConnectionListItem';
export { ResultViewer } from './ResultViewer';
export { DatabaseExplorer } from './DatabaseExplorer';
```

**Usage**:
```tsx
import { ConnectionListItem, ResultViewer, DatabaseExplorer } from '../com';
```

---

## 📊 Performance

- **Scrolling**: Optimisé avec `overflow-auto` + max-heights
- **Rendering**: Conditional render modals/results
- **Tree Navigation**: Limité à 10 items + "... et N autres"
- **Tables**: Scrollable avec sticky headers

---

## 🚀 Futures Améliorations

- [ ] Virtualisation pour grandes listes
- [ ] Export résultats (CSV/JSON)
- [ ] Favoris connexions
- [ ] Historique requêtes
- [ ] Comparaison résultats
- [ ] Real-time WebSocket updates
- [ ] Collaboration (WebRTC)

---

## 📞 Support

Pour questions ou contributions, consulter:
- `COM_V2_ARCHITECTURE.md` - Patterns design détaillés
- `COM_V2_IMPLEMENTATION_SUMMARY.md` - Résumé complet
- Code source inline comments

---

✅ **Composants Réutilisables Prêts pour Production**

Version: 1.0.0 (23 Janvier 2026)
