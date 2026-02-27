# Spendesk MCP Server

Serveur [MCP](https://modelcontextprotocol.io/) qui expose l'[API publique Spendesk](https://developer.spendesk.com/reference/general) sous forme d'**outils** et de **ressources** pour :

- **Automatiser des intégrations ERP** (NetSuite, Xero, QuickBooks, DATEV, etc.)
- **Créer des tableaux de bord** à partir des données Spendesk (settlements, payables, fournisseurs, utilisateurs, etc.)

## Prérequis

- Node.js ≥ 18
- Un **token d'accès** Spendesk (Bearer). Création des identifiants API : *Paramètres > Intégrations > Gestion d'accès API* (compte Premium/Enterprise, statut Account Owner).

## Installation

```bash
npm install
npm run build
```

## Configuration

Variables d'environnement :

| Variable | Obligatoire | Description |
|----------|--------------|-------------|
| `ENCRYPTION_KEY` | Oui (multi-tenant) | Clé de chiffrement 32 bytes (64 caractères hex) pour les tokens clients. Générer avec `node scripts/generate-encryption-key.mjs`. |
| `SPENDESK_API_TOKEN` | Optionnel | Token Bearer (OAuth2 ou identifiants API) en mode fallback. **Ne pas commiter.** Si non défini, les clients doivent s'enregistrer via `/ui`. |
| `SPENDESK_USE_DEMO` | Non | `true` ou `1` pour utiliser l'API démo (`https://public-api.demo.spendesk.com`). |
| `DB_PATH` | Non | Chemin de la base SQLite (défaut : `./data/clients.db`). |

Exemple avec un fichier `.env` (à ne pas commiter) :

```bash
# Générer avec: node scripts/generate-encryption-key.mjs
ENCRYPTION_KEY=your_64_character_hex_key_here

# Optionnel: token fallback si pas de clients enregistrés
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

Le serveur communique en **stdio** : un client MCP (Cursor, Claude Desktop, etc.) peut l'exécuter comme sous-processus et envoyer des requêtes JSON-RPC.

### Configurer Cursor

Dans les paramètres MCP de Cursor (ou dans le fichier de config MCP) :

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

Ou avec `npx` depuis le répertoire du projet :

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

### Configurer Claude Desktop

1. **Compiler le projet** (si ce n’est pas déjà fait) :
   ```bash
   cd /chemin/vers/spendesk-mcp-server
   npm run build
   ```

2. **Ouvrir la config MCP de Claude** :
   - macOS : `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Ou dans Claude Desktop : **Paramètres** → **Developer** → **Edit Config**

3. **Ajouter le serveur Spendesk** dans `mcpServers` (remplacer le chemin et le token) :
   ```json
   {
     "mcpServers": {
       "spendesk": {
         "command": "node",
         "args": ["/chemin/vers/spendesk-mcp-server/dist/index.js"],
         "env": {
           "SPENDESK_API_TOKEN": "<votre_token_spendesk>"
         }
       }
     }
   }
   ```
   Avec un chemin absolu réel, par exemple :
   ```json
   "args": ["/Users/julien.chriqui/spendesk-mcp-server/dist/index.js"]
   ```

4. **Redémarrer complètement Claude Desktop** (quitter l’app puis la rouvrir). Les outils MCP apparaissent (icône 🔨 à côté de la zone de saisie).

**Option multi-tenant (sans token dans la config)** : si le serveur tourne en HTTP avec portail d’enregistrement, Claude Desktop en mode stdio ne peut pas utiliser ce flux. Utilisez alors le token dans `env` comme ci-dessus, ou un outil qui se connecte au serveur HTTP (URL + clé API).

### Serveur HTTP (Streamable) — ChatGPT, etc.

Pour utiliser le MCP depuis **ChatGPT**, un client HTTP ou une plateforme qui parle MCP en Streamable HTTP, lancez le serveur HTTP :

```bash
export SPENDESK_API_TOKEN=your_token
npm run start:http
# écoute par défaut sur http://0.0.0.0:3000
```

Variables utiles pour l'HTTP :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port d'écoute |
| `HOST` | `0.0.0.0` | Interface d'écoute (`0.0.0.0` pour être joignable depuis l'extérieur) |

Endpoints :

- **POST /mcp** — JSON-RPC (initialisation + messages). Le serveur renvoie un en-tête `mcp-session-id` à la première requête d'initialisation.
- **GET /mcp** — Flux SSE (envoyer l'en-tête `mcp-session-id`).
- **DELETE /mcp** — Fermer la session (en-tête `mcp-session-id`).
- **GET /ui** — Portail d'enregistrement client (voir section Multi-tenant ci-dessous).
- **POST /ui/register** — Enregistrer un nouveau client avec son token Spendesk (optionnel : nom de la première company).
- **GET /ui/success** — Page de confirmation après enregistrement (affiche la clé API et la liste des companies).
- **GET /ui/companies** — Gérer ses companies (liste + formulaire pour en ajouter). Requiert `?apiKey=...`.
- **POST /ui/companies** — Ajouter une company (body JSON : `apiKey`, `label`, `token`).

### Portail Multi-tenant

Le serveur supporte un mode **multi-tenant** où chaque client peut enregistrer son propre token Spendesk via un portail web, sans que vous ayez à stocker de tokens en dur dans les variables Railway.

#### Configuration

1. **Générer une clé de chiffrement** :
   ```bash
   node scripts/generate-encryption-key.mjs
   ```
   Copiez la clé générée dans votre `.env` :
   ```bash
   ENCRYPTION_KEY=votre_cle_hex_64_caracteres
   ```

2. **Démarrer le serveur** :
   ```bash
   npm run start:http
   ```

#### Enregistrement d'un client

1. **Accéder au portail** : Ouvrez `http://localhost:3000/ui` (ou votre URL déployée + `/ui`).

2. **Entrer le token Spendesk** : Le client entre son token Bearer Spendesk dans le formulaire. Il peut optionnellement donner un **nom de company** (ex. « Spendesk FR ») pour la première company.

3. **Validation** : Le serveur valide le token en appelant l'API Spendesk, puis génère une **clé API unique** (UUID) et enregistre la première company si un nom a été fourni.

4. **Récupérer la clé API** : La clé API est affichée sur la page de succès. Le client doit la conserver en sécurité. La page affiche aussi la liste des **company_key** à utiliser avec le header `X-Company-Id` (voir Multi-company ci-dessous).

#### Utilisation de la clé API

Le client doit inclure sa clé API dans le header `X-Client-Token` de toutes ses requêtes MCP :

```bash
curl -H "X-Client-Token: <clé-api>" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' \
     https://votre-domaine.com/mcp
```

#### Multi-company (plusieurs companies Spendesk)

Un même client peut avoir **plusieurs companies** (chacune avec son propre token Spendesk), par exemple Spendesk FR et Spendesk UK. Cela permet de construire un **dashboard consolidé** (ex. avec Dust) en interrogeant chaque company puis en agrégeant les données.

1. **Enregistrement** : Lors de l'inscription, donnez un nom à la première company (ex. « Spendesk FR »). Puis, depuis la page de succès, cliquez sur **Gérer mes companies** (`/ui/companies?apiKey=<votre-clé>`) pour ajouter d'autres companies (ex. « Spendesk UK ») avec leur token respectif.

2. **Headers MCP** :
   - **`X-Client-Token`** : votre clé API (obligatoire pour identifier le compte).
   - **`X-Company-Id`** (optionnel) : la **company_key** de la company à interroger (ex. `spendesk-fr`, `spendesk-uk`). Si absent, le serveur utilise la première company ou le token legacy du client.

3. **Exemple avec deux companies (Dust, dashboard consolidé)** :
   - **Dans Dust** : Dust n’envoie que le header `Authorization: Bearer <token>`. Le serveur accepte ce format. Pour avoir **plusieurs companies** dans Dust, ajoutez **plusieurs MCP servers** (même URL, Bearer différent) :
     - MCP 1 : URL = `https://votre-domaine.railway.app/mcp`, **Bearer** = `votre-clé-api:spendesk-fr`
     - MCP 2 : URL = `https://votre-domaine.railway.app/mcp`, **Bearer** = `votre-clé-api:spendesk-uk`
   - Chaque “serveur” expose les mêmes tools mais ciblent une company différente ; les agents Dust peuvent appeler l’un ou l’autre pour agréger les données (ex. dashboard consolidé).
   - Sans `:company_key`, le Bearer = seule la clé API utilise la company par défaut (première enregistrée).

#### Sécurité

- Les tokens Spendesk sont **chiffrés** en base de données (AES-256-GCM).
- Chaque client reçoit une **clé API unique** (UUID v4) qui ne peut pas être devinée.
- Les tokens ne sont jamais loggés ou exposés dans les réponses.
- La validation du token Spendesk est effectuée avant stockage.

#### Mode Fallback

Si aucun header `X-Client-Token` n'est fourni, le serveur utilise `SPENDESK_API_TOKEN` (variable d'environnement) en mode fallback. Cela permet une compatibilité ascendante avec les déploiements existants.

#### Déploiement (Docker, PaaS)

**Docker**

```bash
docker build -t spendesk-mcp-server .
docker run -p 3000:3000 -e ENCRYPTION_KEY=your_key -e SPENDESK_API_TOKEN=your_token spendesk-mcp-server
```

**Déployer sur Railway**

1. **Créer un projet** : [railway.app](https://railway.app) → New Project → Deploy from GitHub repo (ou `railway link` + `railway up` en CLI).
2. **Build** : Railway détecte le **Dockerfile** et build l'image, ou utilise `railway.json` (build : `npm ci && npm run build`, start : `node dist/server-http.js`). Si un Dockerfile est présent, il est utilisé en priorité.
3. **Variables d'environnement** (Settings → Variables) :
   - `ENCRYPTION_KEY` (obligatoire pour multi-tenant) — générer avec `node scripts/generate-encryption-key.mjs`.
   - `SPENDESK_API_TOKEN` (optionnel) — token API Spendesk en mode fallback uniquement.
   - `ALLOWED_HOSTS` (recommandé) — host(s) autorisés pour la validation DNS rebinding, ex. : `votre-service.railway.app` (sans `https://`). Tu peux récupérer le domaine après le premier déploiement (Settings → Networking → Generate domain).
4. **Domaine** : Settings → Networking → Generate domain. L'URL MCP sera `https://<ton-domaine>.railway.app/mcp`, le portail sera sur `https://<ton-domaine>.railway.app/ui`.
5. **Vérifier** : `MCP_BASE_URL=https://<ton-domaine>.railway.app node scripts/test-mcp-http.mjs`

**Render / Fly.io**

- Déployer le dépôt (build : `npm ci && npm run build`, start : `node dist/server-http.js`).
- Définir `ENCRYPTION_KEY` (obligatoire), `SPENDESK_API_TOKEN` (optionnel), et, si besoin, `ALLOWED_HOSTS` (domaine public de l'app).
- L'URL du serveur MCP : `https://votre-app.onrender.com/mcp` (ou ton domaine + `/mcp`).
- Le portail : `https://votre-app.onrender.com/ui` (ou ton domaine + `/ui`).

#### Configurer ChatGPT (ou un client MCP Streamable HTTP)

Dans l'interface ou la config du client MCP (ex. ChatGPT avec MCP, ou OpenAI Responses API) :

1. **Server URL** : `https://votre-domaine.com/mcp` (URL publique de votre déploiement + `/mcp`).
2. **Authorization** : 
   - **Mode multi-tenant** : Ajouter le header `X-Client-Token: <clé-api>` à toutes les requêtes (si le client MCP le supporte). Pour cibler une company (multi-company), ajouter aussi `X-Company-Id: <company_key>` (ex. `spendesk-fr`, `spendesk-uk`).
   - **Dust** : Dust n'envoie que `Authorization: Bearer <token>`. Le serveur accepte ce format. Utilisez **Bearer token** = votre clé API. Pour une company précise, utilisez **Bearer** = `clé-api:company_key` (ex. `b6195ab9-ea5e-486e-80cd-31821c42eaa0:spendesk-fr`). Pour récupérer des données de **plusieurs companies** dans Dust, ajoutez **plusieurs MCP servers** avec la même URL et un Bearer différent par company (ex. un avec `clé:spendesk-fr`, un avec `clé:spendesk-uk`).
   - **Mode fallback** : Le token Spendesk est dans `SPENDESK_API_TOKEN` côté serveur (pas d'auth HTTP requise).
   - Pour protéger l'accès, mettre un reverse proxy (auth, API key) devant `/mcp`.

Le client envoie d'abord une requête POST avec le body JSON-RPC `initialize`, récupère le `mcp-session-id` dans les en-têtes de la réponse, puis réutilise ce session ID pour les requêtes suivantes et pour le flux GET SSE.

#### Tester le MCP déployé (ou local)

Un script vérifie que le serveur HTTP répond correctement (GET /, initialize, tools/list, tools/call) :

```bash
# Test en local (le serveur doit tourner : npm run start:http)
node scripts/test-mcp-http.mjs

# Test vers une URL déployée
MCP_BASE_URL=https://votre-app.up.railway.app node scripts/test-mcp-http.mjs
```

En cas de succès : `✓ MCP HTTP test passed.`

#### Comment tester (multi-tenant / multi-company)

1. **Démarrer le serveur** (avec `ENCRYPTION_KEY` et optionnellement `SPENDESK_API_TOKEN`) :
   ```bash
   npm run start:http
   ```

2. **Récupérer une clé API** : aller sur `http://localhost:3000/ui`, entrer un token Spendesk (et un nom de company, ex. « Spendesk FR »), valider. Sur la page de succès, copier la **clé API** et noter la **company_key** (ex. `spendesk-fr`). Pour une deuxième company : cliquer sur « Gérer mes companies », ajouter « Spendesk UK » avec son token.

3. **Tester le MCP avec la clé API** :
   ```bash
   X_CLIENT_TOKEN=<votre-clé-api> node scripts/test-mcp-http.mjs
   ```

4. **Tester en ciblant une company** (si vous en avez plusieurs) :
   ```bash
   X_CLIENT_TOKEN=<clé-api> X_COMPANY_ID=spendesk-fr node scripts/test-mcp-http.mjs
   X_CLIENT_TOKEN=<clé-api> X_COMPANY_ID=spendesk-uk node scripts/test-mcp-http.mjs
   ```

5. **Tester vers un déploiement** (ex. Railway) :
   ```bash
   MCP_BASE_URL=https://votre-app.railway.app X_CLIENT_TOKEN=<clé-api> node scripts/test-mcp-http.mjs
   ```

Sans `X_CLIENT_TOKEN`, le script utilise le token fallback (`SPENDESK_API_TOKEN`) si le serveur en est configuré.

## Outils (Tools)

Tous les endpoints principaux de l'API Spendesk sont exposés comme outils MCP :

### Spend Data
- `spendesk_get_settlements` – Liste des settlements (avec filtres via `filters`)
- `spendesk_update_settlement_state` – Mise à jour de l'état d'un settlement
- `spendesk_get_bank_fees` – Frais bancaires (avec filtres via `filters`)
- `spendesk_create_payables_snapshot` / `spendesk_get_payables_snapshot` – Snapshots de payables
- `spendesk_get_payable` / `spendesk_get_payable_attachments` – Détail payable et pièces jointes
- `spendesk_update_payable_bookkeeping` – Statut comptable d'un payable (sync ERP)
- **Report (réponses clés en main)** : `spendesk_get_spend_dashboard` – Dashboard spend (répartition par cost center / catégorie / compte de charge) ; `spendesk_get_top_suppliers_by_spend` – Top N fournisseurs par spend avec payables/settlements ; `spendesk_get_purchase_orders_and_payables_export` – Export POs + payables d'une période, liés par fournisseur
- `spendesk_get_wallet_loads` / `spendesk_get_wallet_summary` – Recharges et résumé wallet

### Analytical
- `spendesk_get_analytical_fields` / `spendesk_get_analytical_values` – Champs et valeurs analytiques (appeler d'abord `spendesk_get_analytical_fields` pour obtenir les `fieldId`, puis `spendesk_get_analytical_values` avec l'argument `fieldId`)
- `spendesk_get_cost_centers` / `spendesk_create_cost_center` / `spendesk_update_cost_center` / `spendesk_delete_cost_center` – Centres de coût
- `spendesk_get_expense_categories` – Catégories de dépenses

### Accounting
- `spendesk_get_journal_csv` – Contenu CSV d'un export comptable
- `spendesk_create_accounting_export` – Créer un export comptable
- `spendesk_get_journal_templates` – Modèles de journaux

### Suppliers & Users
- `spendesk_get_suppliers` / `spendesk_get_supplier` – Fournisseurs (avec filtres via `filters`)
- `spendesk_get_users` / `spendesk_get_user` – Utilisateurs (avec filtres via `filters`)

### Webhooks
- `spendesk_create_webhook` / `spendesk_get_webhooks` / `spendesk_get_webhook` / `spendesk_update_webhook` / `spendesk_delete_webhook` – Gestion des webhooks

### Purchase Orders
- `spendesk_get_purchase_orders` / `spendesk_create_purchase_order` – Commandes d'achat (avec filtres via `filters`)

### Découverte / Référence API
- `spendesk_get_api_reference` – Retourne la **référence de l’API** : liste des endpoints (méthode HTTP, path), paramètres (query, path, body), nom de l’outil MCP associé. Utiliser quand on demande « quels sont les endpoints ? », « quels paramètres pour les settlements ? », « structure de l’API ». Optionnel : `mcpTool` (ex. `spendesk_get_settlements`) ou `path` (ex. `payables`) pour filtrer sur un seul endpoint.

Les outils qui listent des éléments acceptent une pagination (`page`, `perPage` 1–100) et des **filtres génériques** via le paramètre `filters` (objet avec n'importe quels query parameters de l'API Spendesk, ex. : `{ from: '2024-01-01', to: '2024-12-31', state: 'completed' }`).

## Réponses clés en main (Claude / Dust)

Les clients peuvent poser **une seule fois** une des trois questions en langage naturel dans Claude ou Dust et recevoir une **réponse correcte, précise et bien structurée** (tableaux Markdown, sections), sans avoir à préciser les outils ou reformater.

### Mapping question → outil

| Question type | Outil à utiliser | Paramètres |
|---------------|------------------|------------|
| Dashboard spend, répartition des dépenses par cost center / catégorie / compte de charge pour une période (ex. Q1 2026, janvier 2026) | `spendesk_get_spend_dashboard` | `from`, `to` (dates ISO) ; optionnel : `groupBy` (`costCenter`, `expenseCategory`, `chargeAccount`) |
| Top 10 (ou N) fournisseurs par spend, avec payables/settlements associés | `spendesk_get_top_suppliers_by_spend` | `from`, `to` ; `limit` (défaut 10) |
| Export des purchase orders créés sur une période avec les payables associés | `spendesk_get_purchase_orders_and_payables_export` | `from`, `to` |

**Convention de dates** : Q1 2026 = `from: 2026-01-01`, `to: 2026-03-31` ; janvier 2026 = `from: 2026-01-01`, `to: 2026-01-31`.

### Format de réponse recommandé

- **Dashboard spend** (après `spendesk_get_spend_dashboard`) : résumé (période, total, devise) ; tableaux Markdown « Par cost center », « Par catégorie de dépense », « Par compte de charge » (colonnes : nom/id, montant, nombre d’éléments).
- **Top fournisseurs** (après `spendesk_get_top_suppliers_by_spend`) : tableau principal (rang, fournisseur, montant total, devise) ; pour chaque fournisseur (ou sur demande) : liste des payables/settlements (id, montant, date).
- **Export POs + payables** (après `spendesk_get_purchase_orders_and_payables_export`) : nombre de POs et de payables sur la période ; tableaux ou listes des POs et des payables ; regroupement par fournisseur si utile.

### Instructions pour Claude / Dust (copier-coller)

Vous pouvez coller le bloc suivant dans les **instructions du projet** (Claude) ou dans le **système du canal** (Dust) pour que l’assistant choisisse le bon outil et formate la réponse :

```
Pour les questions sur le spend (dashboard, répartition par cost center / catégorie / compte de charge), utilise l’outil spendesk_get_spend_dashboard avec from/to selon la période demandée (Q1 = 2026-01-01 à 2026-03-31, janvier = 2026-01-01 à 2026-01-31). Présente le résultat en tableaux Markdown avec les sections par cost center, par catégorie, par compte de charge.

Pour le top 10 fournisseurs par spend, utilise spendesk_get_top_suppliers_by_spend. Affiche un tableau classé et les payables/settlements associés pour chaque fournisseur.

Pour l’export des POs et payables d’une période, utilise spendesk_get_purchase_orders_and_payables_export. Présente les POs et payables sous forme de tableaux, avec regroupement par fournisseur si utile.
```

### Dépannage : « API Payables 404 » ou « Settlements 400 »

Si Dust ou Claude répond que **l’API Payables retourne 404** ou que **Settlements retourne 400** :

- **404 sur Payables**  
  L’API Payables (snapshots / factures fournisseurs) n’est pas disponible pour ton compte. Causes possibles :
  - **Plan Spendesk** : Payables est souvent réservé aux offres Premium/Enterprise (module Invoices / Accounts Payable).
  - **Scopes** : La clé API doit avoir le scope `payable:read` (à activer dans *Paramètres > Intégrations > Gestion d’accès API*).
  - À vérifier dans l’interface Spendesk (Rapports, factures fournisseurs) : si tu n’as pas accès aux payables dans l’app, l’API les expose pas non plus.

- **400 sur Settlements**  
  Requête invalide (paramètres ou format). Vérifier les valeurs passées (dates ISO, pas de paramètres inconnus) pour les filtres `paidFrom`, `clearedFrom`, `clearedTo`, `exportedAfter`. Si l’erreur persiste, contacter le support Spendesk.

**Contournement** : tant que Payables n’est pas disponible, les rapports « top fournisseurs par spend » ou « dashboard spend » ne peuvent pas être calculés par le MCP. Tu peux utiliser les rapports Spendesk (Rapports → filtrer sur la période) ou activer le module Payables / les scopes côté Spendesk pour débloquer l’API.

## Découvrir la structure de l’API

Les clients (Claude, Dust, etc.) peuvent **interroger le MCP** pour connaître les endpoints, paramètres et structures de l’API Spendesk exposée :

- **Outil** `spendesk_get_api_reference` : retourne la référence complète (baseUrl, endpoints avec method, path, queryParams, pathParams, bodyParams, mcpTool, responseNote). Paramètres optionnels : `mcpTool` pour un outil donné (ex. `spendesk_get_settlements`), `path` pour filtrer par chemin (ex. `settlements`).
- **Ressource** `spendesk://api-reference` : même contenu en lecture seule (idéal pour l’injecter en contexte ou pour les clients qui lisent les ressources).

Exemples de questions que l’assistant peut résoudre en appelant l’outil ou en lisant la ressource : « Quels paramètres accepte l’API settlements ? », « Quel endpoint pour lister les payables ? », « Quelle est la structure des endpoints Purchase Orders ? ».

## Ressources (Resources)

Données en lecture seule, utiles pour alimenter des dashboards ou du contexte :

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
| `spendesk://api-reference` | **Référence API** : endpoints, paramètres, structures (pour découvrir comment utiliser l’API) |

Les ressources renvoient du JSON (UTF-8).

## Référence API

Documentation officielle : [Spendesk Public API](https://developer.spendesk.com/reference/general).

## Licence

MIT.
