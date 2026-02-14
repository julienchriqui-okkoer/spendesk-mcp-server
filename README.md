# Spendesk MCP Server

Serveur [MCP](https://modelcontextprotocol.io/) qui expose l’[API publique Spendesk](https://developer.spendesk.com/reference/general) sous forme d’**outils** et de **ressources** pour :

- **Automatiser des intégrations ERP** (NetSuite, Xero, QuickBooks, DATEV, etc.)
- **Créer des tableaux de bord** à partir des données Spendesk (settlements, payables, fournisseurs, utilisateurs, etc.)

## Prérequis

- Node.js ≥ 18
- Un **token d’accès** Spendesk (Bearer). Création des identifiants API : *Paramètres > Intégrations > Gestion d’accès API* (compte Premium/Enterprise, statut Account Owner).

## Installation

```bash
npm install
npm run build
```

## Configuration

Variables d’environnement :

| Variable | Obligatoire | Description |
|----------|--------------|-------------|
| `SPENDESK_API_TOKEN` | Oui | Token Bearer (OAuth2 ou identifiants API). **Ne pas commiter.** |
| `SPENDESK_USE_DEMO` | Non | `true` ou `1` pour utiliser l’API démo (`https://public-api.demo.spendesk.com`). |

Exemple avec un fichier `.env` (à ne pas commiter) :

```bash
SPENDESK_API_TOKEN=your_token_here
# SPENDESK_USE_DEMO=true
```

## Utilisation

### Lancer le serveur (stdio)

```bash
export SPENDESK_API_TOKEN=your_token
npm start
# ou
node dist/index.js
```

Le serveur communique en **stdio** : un client MCP (Cursor, Claude Desktop, etc.) peut l’exécuter comme sous-processus et envoyer des requêtes JSON-RPC.

### Configurer Cursor

Dans les paramètres MCP de Cursor (ou dans le fichier de config MCP) :

```json
{
  "mcpServers": {
    "spendesk": {
      "command": "node",
      "args": ["/chemin/vers/spendesk-mcp-server/dist/index.js"],
      "env": {
        "SPENDESK_API_TOKEN": "<votre_token>"
      }
    }
  }
}
```

Ou avec `npx` depuis le répertoire du projet :

```json
{
  "mcpServers": {
    "spendesk": {
      "command": "npx",
      "args": ["-y", "tsx", "src/index.ts"],
      "cwd": "/chemin/vers/spendesk-mcp-server",
      "env": {
        "SPENDESK_API_TOKEN": "<votre_token>"
      }
    }
  }
}
```

(En production, privilégier `node dist/index.js` après `npm run build`.)

### Serveur HTTP (Streamable) — ChatGPT, etc.

Pour utiliser le MCP depuis **ChatGPT**, un client HTTP ou une plateforme qui parle MCP en Streamable HTTP, lancez le serveur HTTP :

```bash
export SPENDESK_API_TOKEN=your_token
npm run start:http
# écoute par défaut sur http://0.0.0.0:3000
```

Variables utiles pour l’HTTP :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port d’écoute |
| `HOST` | `0.0.0.0` | Interface d’écoute (`0.0.0.0` pour être joignable depuis l’extérieur) |

Endpoints :

- **POST /mcp** — JSON-RPC (initialisation + messages). Le serveur renvoie un en-tête `mcp-session-id` à la première requête d’initialisation.
- **GET /mcp** — Flux SSE (envoyer l’en-tête `mcp-session-id`).
- **DELETE /mcp** — Fermer la session (en-tête `mcp-session-id`).

#### Déploiement (Docker, PaaS)

**Docker**

```bash
docker build -t spendesk-mcp-server .
docker run -p 3000:3000 -e SPENDESK_API_TOKEN=your_token spendesk-mcp-server
```

**Déployer sur Railway**

1. **Créer un projet** : [railway.app](https://railway.app) → New Project → Deploy from GitHub repo (ou `railway link` + `railway up` en CLI).
2. **Build** : Railway détecte le **Dockerfile** et build l’image, ou utilise `railway.json` (build : `npm ci && npm run build`, start : `node dist/server-http.js`). Si un Dockerfile est présent, il est utilisé en priorité.
3. **Variables d’environnement** (Settings → Variables) :
   - `SPENDESK_API_TOKEN` (obligatoire) — token API Spendesk.
   - `ALLOWED_HOSTS` (recommandé) — host(s) autorisés pour la validation DNS rebinding, ex. : `votre-service.railway.app` (sans `https://`). Tu peux récupérer le domaine après le premier déploiement (Settings → Networking → Generate domain).
4. **Domaine** : Settings → Networking → Generate domain. L’URL MCP sera `https://<ton-domaine>.railway.app/mcp`.
5. **Vérifier** : `MCP_BASE_URL=https://<ton-domaine>.railway.app node scripts/test-mcp-http.mjs`

**Render / Fly.io**

- Déployer le dépôt (build : `npm ci && npm run build`, start : `node dist/server-http.js`).
- Définir `SPENDESK_API_TOKEN` et, si besoin, `ALLOWED_HOSTS` (domaine public de l’app).
- L’URL du serveur MCP : `https://votre-app.onrender.com/mcp` (ou ton domaine + `/mcp`).

#### Configurer ChatGPT (ou un client MCP Streamable HTTP)

Dans l’interface ou la config du client MCP (ex. ChatGPT avec MCP, ou OpenAI Responses API) :

1. **Server URL** : `https://votre-domaine.com/mcp` (URL publique de votre déploiement + `/mcp`).
2. **Authorization** (si le client le supporte) : optionnel ; ce serveur n’utilise pas d’auth HTTP par défaut (le token Spendesk est dans `SPENDESK_API_TOKEN` côté serveur). Pour protéger l’accès, mettre un reverse proxy (auth, API key) devant `/mcp`.

Le client envoie d’abord une requête POST avec le body JSON-RPC `initialize`, récupère le `mcp-session-id` dans les en-têtes de la réponse, puis réutilise ce session ID pour les requêtes suivantes et pour le flux GET SSE.

#### Tester le MCP déployé (ou local)

Un script vérifie que le serveur HTTP répond correctement (GET /, initialize, tools/list, tools/call) :

```bash
# Test en local (le serveur doit tourner : npm run start:http)
node scripts/test-mcp-http.mjs

# Test vers une URL déployée
MCP_BASE_URL=https://votre-app.up.railway.app node scripts/test-mcp-http.mjs
```

En cas de succès : `✓ MCP HTTP test passed.`

## Outils (Tools)

Tous les endpoints principaux de l’API Spendesk sont exposés comme outils MCP :

### Spend Data
- `spendesk_get_settlements` – Liste des settlements
- `spendesk_update_settlement_state` – Mise à jour de l’état d’un settlement
- `spendesk_get_bank_fees` – Frais bancaires
- `spendesk_create_payables_snapshot` / `spendesk_get_payables_snapshot` – Snapshots de payables
- `spendesk_get_payable` / `spendesk_get_payable_attachments` – Détail payable et pièces jointes
- `spendesk_update_payable_bookkeeping` – Statut comptable d’un payable (sync ERP)
- `spendesk_get_wallet_loads` / `spendesk_get_wallet_summary` – Recharges et résumé wallet

### Analytical
- `spendesk_get_analytical_fields` / `spendesk_get_analytical_values` – Champs et valeurs analytiques (appeler d’abord `spendesk_get_analytical_fields` pour obtenir les `fieldId`, puis `spendesk_get_analytical_values` avec l’argument `fieldId`)
- `spendesk_get_cost_centers` / `spendesk_create_cost_center` / `spendesk_update_cost_center` / `spendesk_delete_cost_center` – Centres de coût
- `spendesk_get_expense_categories` – Catégories de dépenses

### Accounting
- `spendesk_get_journal_csv` – Contenu CSV d’un export comptable
- `spendesk_create_accounting_export` – Créer un export comptable
- `spendesk_get_journal_templates` – Modèles de journaux

### Suppliers & Users
- `spendesk_get_suppliers` / `spendesk_get_supplier` – Fournisseurs
- `spendesk_get_users` / `spendesk_get_user` – Utilisateurs

### Webhooks
- `spendesk_create_webhook` / `spendesk_get_webhooks` / `spendesk_get_webhook` / `spendesk_update_webhook` / `spendesk_delete_webhook` – Gestion des webhooks

### Purchase Orders
- `spendesk_get_purchase_orders` / `spendesk_create_purchase_order` – Commandes d’achat

Les outils qui listent des éléments acceptent en général une pagination : `page`, `perPage` (1–100).

## Ressources (Resources)

Données en lecture seule, utiles pour alimenter des dashboards ou du contexte :

| URI | Description |
|-----|-------------|
| `spendesk://settlements` | Liste des settlements |
| `spendesk://suppliers` | Liste des fournisseurs |
| `spendesk://users` | Liste des utilisateurs |
| `spendesk://wallet-summary` | Résumé wallet |
| `spendesk://cost-centers` | Centres de coût |
| `spendesk://expense-categories` | Catégories de dépenses |
| `spendesk://analytical-fields` | Champs analytiques |
| `spendesk://bank-fees` | Frais bancaires |
| `spendesk://wallet-loads` | Recharges wallet |
| `spendesk://journal-templates` | Modèles de journaux comptables |

Les ressources renvoient du JSON (UTF-8).

## Référence API

Documentation officielle : [Spendesk Public API](https://developer.spendesk.com/reference/general).

## Licence

MIT.
