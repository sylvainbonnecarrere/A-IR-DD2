# Image Capabilities Module

## 📌 Vue d'Ensemble

Module extensible pour gérer les capacités d'image (génération, modification) des différents LLMs. Applique les **Design Patterns Strategy + Factory + Adapter** pour une architecture scalable.

---

## 🎯 Problème Résolu

Chaque LLM a son propre pattern d'API pour les images :

| LLM | API Pattern | Génération | Modification |
|-----|-------------|------------|--------------|
| Gemini | Google AI SDK | ✅ Imagen 4.0 | ✅ Gemini 2.5 Flash Image |
| OpenAI | REST API | ✅ DALL-E 3 | ❌ Non supporté |
| Stability AI | REST API | ✅ SD XL / SD3 | ✅ Inpainting |
| Flux | Replicate | ✅ Flux Schnell | ✅ ControlNet |

**Solution** : Interface unifiée avec implémentations spécifiques (Strategies).

---

## 🏗️ Architecture

```
┌─────────────────┐
│  Application    │  (App.tsx, panels)
└────────┬────────┘
         │ utilise
         ▼
┌─────────────────┐
│ llmService.ts   │  ← Facade actuelle (backward compat)
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│  imageCapabilities/index.ts                  │  ← API unifiée
│  - generateImageUnified()                    │
│  - modifyImageUnified()                      │
│  - supportsImageGeneration()                 │
└────────┬─────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│  imageServiceAdapter.ts                      │  ← Types + Factory
│  - ImageServiceStrategy (interface)          │
│  - ImageServiceFactory (registry)            │
│  - ImageGenerationOptions (extensible)       │
└────────┬─────────────────────────────────────┘
         │
         ├──────────┬──────────┬──────────┐
         ▼          ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │ Gemini │ │ OpenAI │ │Stability│ │  Flux  │  ← Strategies
    │Strategy│ │Strategy│ │Strategy │ │Strategy│
    └────┬───┘ └────┬───┘ └────┬────┘ └────┬───┘
         │          │          │            │
         ▼          ▼          ▼            ▼
    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │gemini  │ │openAI  │ │stability│ │  flux  │  ← Services natifs
    │Service │ │Service │ │Service  │ │Service │
    └────────┘ └────────┘ └────────┘ └────────┘
```

---

## 🚀 Usage

### Simple (Backward Compatible)
```typescript
import * as llmService from './services/llmService';

// Format existant continue de fonctionner
const result = await llmService.generateImage(
    LLMProvider.Gemini,
    apiKey,
    'un chat astronaute'
);

if (result.image) {
    console.log('Image générée:', result.image.substring(0, 50));
}
```

### Avancé (Nouvelles Options)
```typescript
import { generateImageUnified } from './services/imageCapabilities';

// Options extensibles pour futurs LLMs
const result = await generateImageUnified(
    LLMProvider.StabilityAI,
    apiKey,
    {
        prompt: 'un chat astronaute',
        aspectRatio: '16:9',
        style: 'realistic',
        negativePrompt: 'blurry, low quality',
        seed: 42,
        guidanceScale: 7.5
    }
);

console.log('Metadata:', result.metadata);
// { model: 'stable-diffusion-xl', dimensions: { width: 1792, height: 1024 } }
```

### Vérification des Capacités
```typescript
import { supportsImageGeneration, supportsImageModification } from './services/imageCapabilities';

const canGenerate = supportsImageGeneration(LLMProvider.Gemini); // true
const canModify = supportsImageModification(LLMProvider.OpenAI); // false

console.log(`Gemini peut générer: ${canGenerate}`);
console.log(`OpenAI peut modifier: ${canModify}`);
```

---

## 📁 Structure des Fichiers

```
services/imageCapabilities/
├── index.ts                         # Point d'entrée + API unifiée
├── imageServiceAdapter.ts           # Types, interfaces, factory (220 lignes)
├── geminiImageStrategy.ts           # Implémentation Gemini (90 lignes) ✅ ACTIF
├── openAIImageStrategy.ts           # Implémentation OpenAI (75 lignes) ✅ ACTIF
└── futureImageStrategies.ts         # Templates pour futurs LLMs (280 lignes) 📋 TEMPLATES
```

### Fichiers Clés

#### `imageServiceAdapter.ts`
- **Types** : `ImageGenerationOptions`, `ImageModificationOptions`, `ImageOperationResult`
- **Interface** : `ImageServiceStrategy` (contrat pour chaque LLM)
- **Factory** : `ImageServiceFactory` (registry des strategies)
- **Enums** : `ImageAPIPattern` (patterns d'API identifiés)

#### `{provider}ImageStrategy.ts`
Chaque Strategy implémente :
```typescript
interface ImageServiceStrategy {
    generateImage(apiKey, options): Promise<ImageOperationResult>
    modifyImage(apiKey, options): Promise<ImageOperationResult>
    supportsGeneration(): boolean
    supportsModification(): boolean
    getAPIPattern(): ImageAPIPattern
}
```

#### `futureImageStrategies.ts`
Templates prêts pour :
- Stability AI (Stable Diffusion)
- Flux (Black Forest Labs)
- Midjourney (via API tierce)
- Ideogram (texte dans images)
- Recraft V3 (design vectoriel)
- Anthropic (future génération)

---

## 🔧 Ajouter un Nouveau LLM

### Quick Start (3 étapes)

1. **Créer la Strategy**
```typescript
// services/imageCapabilities/nouveauLLMImageStrategy.ts
export class NouveauLLMImageStrategy implements ImageServiceStrategy {
    // ... implémentation
}
```

2. **Enregistrer**
```typescript
// services/imageCapabilities/index.ts
import { NouveauLLMImageStrategy } from './nouveauLLMImageStrategy';

export function initializeImageStrategies() {
    ImageServiceFactory.registerStrategy(
        LLMProvider.NouveauLLM,
        new NouveauLLMImageStrategy()
    );
}
```

3. **Déclarer Capabilities**
```typescript
// llmModels.ts
[LLMProvider.NouveauLLM]: [{
    id: 'model-v1',
    name: 'Model v1',
    capabilities: [LLMCapability.ImageGeneration],
}]
```

**Guide complet** : `documentation/IMAGE_INTEGRATION_GUIDE.md`

---

## 🧪 Tests

### Test de Génération
```bash
npm run test:image-generation
```

```typescript
// Exemple de test
const result = await generateImageUnified(
    LLMProvider.Gemini,
    process.env.GEMINI_API_KEY,
    { prompt: 'un chat astronaute' }
);

expect(result.image).toBeDefined();
expect(result.error).toBeUndefined();
expect(result.metadata?.model).toBe('imagen-4.0-generate-001');
```

---

## 📊 Patterns d'API Supportés

### 1. Gemini Generative AI
```typescript
ai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt: '...',
    config: { numberOfImages: 1, outputMimeType: 'image/png' }
})
```

### 2. OpenAI REST
```typescript
fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    body: JSON.stringify({
        model: 'dall-e-3',
        prompt: '...',
        size: '1024x1024',
        response_format: 'b64_json'
    })
})
```

### 3. Stability AI (Future)
```typescript
fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
    method: 'POST',
    body: JSON.stringify({
        prompt: '...',
        negative_prompt: '...',
        aspect_ratio: '16:9',
        seed: 42
    })
})
```

---

## 🔮 Roadmap

| Trimestre | LLM | Status |
|-----------|-----|--------|
| Q4 2025 | Gemini, OpenAI | ✅ Actif |
| Q1 2026 | Flux, Ideogram | 📋 Templates prêts |
| Q2 2026 | Stability AI, Recraft | 📋 Templates prêts |
| Q3 2026 | Midjourney | 📋 En attente API officielle |
| Q4 2026 | Anthropic | 📋 Si Claude Image Gen sort |

---

## 🛡️ Sécurité & Non-Régression

### Règles Critiques
1. ✅ Ne JAMAIS modifier les signatures existantes dans `llmService.ts`
2. ✅ Toujours supporter le format simple (string) ET avancé (options)
3. ✅ Strategies non implémentées → erreurs explicites
4. ✅ Valider backward compatibility avant merge

### Tests de Régression
```typescript
// Test 1: Format simple (backward compat)
const result1 = await llmService.generateImage(provider, key, 'prompt');
expect(result1.image).toBeDefined();

// Test 2: Format avancé (forward compat)
const result2 = await generateImageUnified(provider, key, { prompt: '...', seed: 42 });
expect(result2.image).toBeDefined();
```

---

## 📚 Documentation

- **Architecture** : `documentation/IMAGE_CAPABILITIES_ARCHITECTURE.md`
- **Guide d'intégration** : `documentation/IMAGE_INTEGRATION_GUIDE.md`
- **API Reference** : Voir JSDoc dans `imageServiceAdapter.ts`

---

## 🤝 Contribution

### Ajouter un Nouveau LLM
1. Lire `IMAGE_INTEGRATION_GUIDE.md`
2. Créer la Strategy dans `imageCapabilities/{provider}ImageStrategy.ts`
3. Enregistrer dans `index.ts`
4. Tester avec format simple ET avancé
5. Mettre à jour la roadmap dans ce README

### Modifier une Strategy Existante
1. **Ne PAS** changer l'interface `ImageServiceStrategy`
2. Ajouter des options dans `ImageGenerationOptions` (optionnelles)
3. Tester backward compatibility
4. Documenter les nouvelles options supportées

---

## 👥 Maintenance

**Architecte** : ARC-1 (Agent IA Architecte)  
**Chef de Projet** : Utilisateur  
**Robot** : Archi (prototypage)  

**Version** : 2.0.0  
**Dernière mise à jour** : 2025-11-13
