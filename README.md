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
| `SPENDESK_API_TOKEN` | Recommandé | Token Bearer (OAuth2 ou identifiants API) utilisé par défaut quand le client ne fournit pas de credentials explicites. **Ne pas commiter.** |
| `SPENDESK_USE_DEMO` | Non | `true` ou `1` : utilise l’API **démo** (URL sandbox + `SPENDESK_CLIENT_ID_DEMO` / `SPENDESK_CLIENT_SECRET_DEMO`). Sinon : prod (URL publique + `SPENDESK_CLIENT_ID` / `SPENDESK_CLIENT_SECRET`). |
| `SPENDESK_CLIENT_ID` | Non | Client ID Spendesk (prod). Utilisé en fallback quand le client n’envoie pas de credentials et `SPENDESK_USE_DEMO` est faux. |
| `SPENDESK_CLIENT_SECRET` | Non | Client secret Spendesk (prod). À définir avec `SPENDESK_CLIENT_ID` pour le fallback prod. |
| `SPENDESK_CLIENT_ID_DEMO` | Non | Client ID Spendesk **démo**. Utilisé en fallback quand `SPENDESK_USE_DEMO=true`. |
| `SPENDESK_CLIENT_SECRET_DEMO` | Non | Client secret Spendesk **démo**. À définir avec `SPENDESK_CLIENT_ID_DEMO` pour le fallback démo. |
| `DB_PATH` | Non | Chemin de la base SQLite utilisée pour le **monitoring** (`mcp_usage_events`). Défaut : `./data/clients.db`. |
| `DOCS_URL` | Non | URL de la documentation (Mintlify). Si définie, `GET /doc` redirige vers cette URL. |
| `USAGE_UI_SECRET` | Non | Si définie, la page **GET /usage** (dashboard MCP) exige `?secret=<valeur>` ou `Authorization: Bearer <valeur>`. |

Exemple avec un fichier `.env` (à ne pas commiter) :

```bash
# Token Spendesk utilisé par défaut si le client ne fournit pas de credentials (ne pas commiter)
SPENDESK_API_TOKEN=your_token_here

# Ou client credentials (alternative à SPENDESK_API_TOKEN)
# Prod : SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET
# SPENDESK_CLIENT_ID=your_client_id
# SPENDESK_CLIENT_SECRET=your_client_secret
# Démo : SPENDESK_USE_DEMO=true + SPENDESK_CLIENT_ID_DEMO + SPENDESK_CLIENT_SECRET_DEMO
# SPENDESK_USE_DEMO=true
# SPENDESK_CLIENT_ID_DEMO=your_demo_client_id
# SPENDESK_CLIENT_SECRET_DEMO=your_demo_client_secret
```

### Désactiver certains outils (expérimentaux)

Pour ne pas exposer certains tools (par exemple expérimentaux), créez un fichier de configuration. Les tools désactivés ne sont **pas enregistrés** et n’apparaissent **pas** dans la référence API (tool `spendesk_get_api_reference` et ressource `spendesk://api-reference`).

Fichier **`config/tools.config.json`** à la racine du projet (ou `tools.config.json`) :

```json
{
  "disabledTools": [
    "spendesk_get_accruals",
    "spendesk_get_purchase_orders"
  ]
}
```

Le serveur lit ce fichier au démarrage. Pour réactiver un tool, retirez son nom de `disabledTools` et redémarrez le serveur.

**Doc Mintlify** : pour que la doc (spendesk-mcp-docs) n’affiche que les tools activés, exécutez avant de lancer ou déployer la doc :

```bash
npm run docs:sync-tools
```

Puis lancez la doc en local avec `npm run docs:dev` (sync + `mintlify dev`). Les pages overview, bookkeeping, accounts-payable, reference-data et spend-analysis sont mises à jour pour masquer les tools désactivés.

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
- **GET /doc** — Redirection vers la documentation (Mintlify). Définir `DOCS_URL` pour l’URL cible ; sinon une page d’information s’affiche.
- **GET /usage** — Dashboard d’usage MCP (volume par jour, top tools, derniers appels). Optionnel : définir `USAGE_UI_SECRET` pour protéger l’accès.

### Authentification HTTP et déploiement

L’interface `/ui` et le mode multi-tenant (base SQLite + clés API) ont été retirés.  
L’authentification se fait désormais uniquement via :

- des **credentials fournis par le client** (client credentials ou token API Spendesk), ou
- des **variables d’environnement** configurées sur le serveur.

#### Credentials fournis par le client (Dust / Claude)

Le **client_id** et le **client_secret** Spendesk peuvent être fournis par le client à la connexion, sans les mettre en dur sur Railway :

- **Bearer** : `Authorization: Bearer client_credentials:<base64(client_id:client_secret)>`.  
  Générer avec : `node scripts/generate-dust-bearer.mjs <client_id> <client_secret>` et coller le résultat dans le champ Bearer (ex. dans Dust).
- **Headers** : `X-Spendesk-Client-Id: <id>` et `X-Spendesk-Client-Secret: <secret>`.

Le serveur appelle alors `POST /v1/auth/token` avec ces identifiants pour la session et renouvelle le token automatiquement sur 401.

#### Mode Fallback (variables d’environnement)

Si aucun header d’auth n’est fourni, le serveur utilise les variables d’environnement :

- **Client credentials** : selon `SPENDESK_USE_DEMO`, le serveur utilise soit `SPENDESK_CLIENT_ID` + `SPENDESK_CLIENT_SECRET` (prod), soit `SPENDESK_CLIENT_ID_DEMO` + `SPENDESK_CLIENT_SECRET_DEMO` (démo). Dans les deux cas, il appelle POST `/v1/auth/token` avec Basic auth.
- **Token Bearer** : `SPENDESK_API_TOKEN` (optionnellement `SPENDESK_REFRESH_TOKEN` pour le renouvellement automatique sur 401).

L’URL de l’API Spendesk est aussi choisie selon `SPENDESK_USE_DEMO` (sandbox vs public-api). Cela permet d’exécuter le MCP en **mode single-tenant** (un seul compte Spendesk servi par cette instance), en prod ou en démo.

#### Déploiement (Docker, PaaS)

**Docker**

```bash
docker build -t spendesk-mcp-server .
docker run -p 3000:3000 \
  -e SPENDESK_API_TOKEN=your_token \
  spendesk-mcp-server
```

**Déployer sur Railway**

1. **Créer un projet** : [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
2. **Build** : Railway détecte le **Dockerfile** et build l'image, ou utilise `railway.json` (build : `npm ci && npm run build`, start : `node dist/server-http.js`). Si un Dockerfile est présent, il est utilisé en priorité.
3. **Variables d'environnement** (Settings → Variables) :
   - **Environnement** : `SPENDESK_USE_DEMO` = `true` pour la sandbox démo, `false` ou non défini pour la prod.
   - **Auth Spendesk** (au moins une option pour l’environnement choisi) :
     - **Option A — Client credentials prod** : `SPENDESK_CLIENT_ID` + `SPENDESK_CLIENT_SECRET` (quand `SPENDESK_USE_DEMO` est faux).
     - **Option A bis — Client credentials démo** : `SPENDESK_CLIENT_ID_DEMO` + `SPENDESK_CLIENT_SECRET_DEMO` (quand `SPENDESK_USE_DEMO=true`).
     - **Option B — Token Bearer** : `SPENDESK_API_TOKEN` (token API Spendesk). Optionnellement `SPENDESK_REFRESH_TOKEN` pour le renouvellement automatique sur 401.
   - `ALLOWED_HOSTS` (recommandé) — host(s) autorisés pour la validation DNS rebinding, ex. : `votre-service.railway.app` (sans `https://`). Tu peux récupérer le domaine après le premier déploiement (Settings → Networking → Generate domain).
4. **Domaine** : Settings → Networking → Generate domain. L'URL MCP sera `https://<ton-domaine>.railway.app/mcp`.
5. **Vérifier** : `MCP_BASE_URL=https://<ton-domaine>.railway.app node scripts/test-mcp-http.mjs`

**Render / Fly.io**

- Déployer le dépôt (build : `npm ci && npm run build`, start : `node dist/server-http.js`).
- Définir soit `SPENDESK_CLIENT_ID` + `SPENDESK_CLIENT_SECRET`, soit `SPENDESK_API_TOKEN` (et, si besoin, `ALLOWED_HOSTS` pour le domaine public de l'app).
- L'URL du serveur MCP : `https://votre-app.onrender.com/mcp` (ou ton domaine + `/mcp`).

**Déployer la documentation (Mintlify) sur Railway**

La doc (Mintlify) est dans `spendesk-mcp-docs/`. Pour la déployer sur Railway en tant que second service : créer un **nouveau** service Railway à partir du même dépôt, définir **Root Directory** sur `spendesk-mcp-docs`, puis déployer. Le build exécute `npm ci`, le start lance un proxy qui relaie le serveur Mintlify. Générer un domaine dans Settings → Networking. Voir `spendesk-mcp-docs/README.md` pour le détail.

#### Configurer ChatGPT (ou un client MCP Streamable HTTP)

Dans l'interface ou la config du client MCP (ex. ChatGPT avec MCP, ou OpenAI Responses API) :

1. **Server URL** : `https://votre-domaine.com/mcp` (URL publique de votre déploiement + `/mcp`).
 2. **Authorization** (au choix) :
   - **Client credentials (fournis par le client, sans rien en dur sur Railway)** : pour que Dust/Claude envoie le client_id et client_secret Spendesk à la connexion :
     - **Option A — Bearer** : Bearer = `client_credentials:<base64(client_id:client_secret)>`. Générer le token avec : `node scripts/generate-dust-bearer.mjs <client_id> <client_secret>` puis coller la sortie dans le champ Bearer de Dust.
     - **Option B — Headers** : ajouter les headers `X-Spendesk-Client-Id` et `X-Spendesk-Client-Secret` (section « Networking & Headers » dans Dust). Pas besoin de Bearer dans ce cas.
   - **Token API direct** : Bearer = `SPENDESK_API_TOKEN` (token API Spendesk).
   - **Mode fallback** : si aucun header n’est envoyé, le serveur utilise les variables d’environnement (`SPENDESK_CLIENT_ID` + `SPENDESK_CLIENT_SECRET` ou `SPENDESK_API_TOKEN`).
   - Pour protéger l’accès, mettre un reverse proxy (auth, API key) devant `/mcp`.

Le client envoie d'abord une requête POST avec le body JSON-RPC `initialize`, récupère le `mcp-session-id` dans les en-têtes de la réponse, puis réutilise ce session ID pour les requêtes suivantes et pour le flux GET SSE.

#### Tester le MCP déployé (ou local)

Un script vérifie que le serveur HTTP répond correctement (GET /, initialize, tools/list, tools/call) :

```bash
# Test en local (le serveur doit tourner : npm run start:http)
SPENDESK_API_TOKEN=<votre-token> node scripts/test-mcp-http.mjs

# Test vers une URL déployée
MCP_BASE_URL=https://votre-app.up.railway.app SPENDESK_API_TOKEN=<votre-token> node scripts/test-mcp-http.mjs
```

En cas de succès : `✓ MCP HTTP test passed.`

#### Tester les outils composites (analyse spend, bookkeeping, AP aging, cash flow)

Un script appelle les 5 outils composites pour vérifier qu’ils répondent correctement :

```bash
# 1. Démarrer le serveur (dans un premier terminal)
npm run start:http

# 2. Dans un second terminal (le .env doit contenir SPENDESK_API_TOKEN)
node scripts/test-composite-tools.mjs
```

Le script appelle successivement : `spendesk_analyze_spend`, `spendesk_get_bookkeeping_pipeline`, `spendesk_get_payment_status`, `spendesk_get_ap_aging`, `spendesk_get_cash_flow_forecast` sur une période exemple (janvier 2026). En cas d’erreur (token, 404, timeout snapshot), le message s’affiche pour chaque outil.

Pour tester les payables snapshot et la pagination :

```bash
FROM_DATE=2026-02-26 node scripts/test-payables-from-date.mjs
```

### Ephemeral SQLite Analytics (pattern type Ramp)

Au lieu de renvoyer de gros JSON au LLM, vous pouvez charger les données Spendesk dans une **base SQLite en mémoire** par session, puis laisser le LLM exécuter des requêtes SQL en lecture seule. Utile pour des analyses croisées, agrégations et rapports comptables.

**Workflow recommandé pour le LLM :**

1. Appeler **`spendesk_load_sqlite_data`** avec le jeu de données (`payables`, `settlements`, `suppliers`, `purchase_orders`) et, pour les payables, la plage de dates (`from_date`, `to_date`).
2. Appeler **`spendesk_list_loaded_tables`** pour confirmer le schéma et le nombre de lignes.
3. Appeler **`spendesk_execute_sql_query`** avec des requêtes SQL analytiques (SELECT / WITH uniquement ; résultats plafonnés à 1000 lignes).
4. Appeler **`spendesk_clear_sqlite_tables`** en fin d’analyse pour libérer la mémoire.

**Outils disponibles :**

| Outil | Rôle |
|-------|------|
| `spendesk_load_sqlite_data` | Charge un jeu (payables, settlements, suppliers, purchase_orders) dans une table SQLite en mémoire. Paramètres : `dataset`, `from_date` (optionnel), `to_date` (optionnel). |
| `spendesk_execute_sql_query` | Exécute une requête SQL en lecture seule (SELECT ou WITH). Paramètre : `sql`. |
| `spendesk_list_loaded_tables` | Liste les tables chargées avec colonnes, types et nombre de lignes. |
| `spendesk_clear_sqlite_tables` | Supprime des tables (`table_names`) ou toutes si la liste est vide. |

**Sécurité :** seules les requêtes commençant par `SELECT` ou `WITH` sont acceptées ; les mots-clés `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER` sont refusés.

**Exemples de requêtes SQL (après chargement des payables ou autres tables) :**

```sql
-- 1. Top 10 fournisseurs par montant (EUR)
SELECT supplier_name, SUM(amount_eur) AS total_eur, COUNT(*) AS nb
FROM payables GROUP BY supplier_name ORDER BY total_eur DESC LIMIT 10;

-- 2. Dépenses par centre de coût
SELECT cost_center, SUM(amount_eur) AS total_eur FROM payables
WHERE cost_center IS NOT NULL AND cost_center != '' GROUP BY cost_center ORDER BY total_eur DESC;

-- 3. Factures non payées (unpaid)
SELECT id, supplier_name, amount_eur, payable_date, due_date FROM payables
WHERE payment_status = 'unpaid' ORDER BY due_date;

-- 4. Répartition par type de payable (invoice, card, expense…)
SELECT payable_type, COUNT(*) AS nb, SUM(amount_eur) AS total_eur
FROM payables GROUP BY payable_type ORDER BY total_eur DESC;

-- 5. Tendance mensuelle (montant par mois)
SELECT strftime('%Y-%m', payable_date) AS month, SUM(amount_eur) AS total_eur, COUNT(*) AS nb
FROM payables GROUP BY month ORDER BY month;

-- 6. Payables non encore exportés en compta (bookkeeping_status = created)
SELECT supplier_name, SUM(amount_eur) AS total_eur FROM payables
WHERE bookkeeping_status = 'created' GROUP BY supplier_name ORDER BY total_eur DESC;

-- 7. Montant par devise d’origine
SELECT original_currency, SUM(amount_eur) AS total_eur, COUNT(*) AS nb
FROM payables GROUP BY original_currency ORDER BY total_eur DESC;

-- 8. Settlements : montant par état (processing, completed, failed, pending)
SELECT state, COUNT(*) AS nb, SUM(amount_eur) AS total FROM settlements GROUP BY state;

-- 9. Top fournisseurs sur les purchase orders
SELECT supplier_name, COUNT(*) AS nb_po, SUM(total_amount) AS total FROM purchase_orders
GROUP BY supplier_name ORDER BY total DESC LIMIT 10;

-- 10. Jointure payables + type pour analyse détaillée
SELECT payable_type, bookkeeping_status, COUNT(*) AS nb, SUM(amount_eur) AS total_eur
FROM payables GROUP BY payable_type, bookkeeping_status ORDER BY total_eur DESC;
```

## Outils (Tools)

Tous les endpoints principaux de l'API Spendesk sont exposés comme outils MCP :

### Spend Data
- `spendesk_get_settlements` – Liste des settlements (avec filtres via `filters`)
- `spendesk_update_settlement_state` – Mise à jour de l'état d'un settlement
- `spendesk_get_bank_fees` – Frais bancaires (`chargedFrom` / `chargedTo` pour limiter par date, ou `filters`). Voir [Export bank fees → NetSuite](docs/export-bank-fees-to-netsuite.md) pour le flow journalisation quotidienne.
- `spendesk_create_payables_snapshot` / `spendesk_get_payables_snapshot` – Snapshots de payables (création : filtres Public API ; récupération : pagination `page`, `perPage` max 100, `filters` en camelCase)
- `spendesk_get_payable` / `spendesk_get_payable_attachments` – Détail payable et pièces jointes
- `spendesk_update_payable_bookkeeping` – Statut comptable d'un payable (sync ERP)
- **Report (réponses clés en main)** : `spendesk_get_spend_dashboard` – Dashboard spend (répartition par cost center / catégorie / compte de charge) ; `spendesk_get_top_suppliers_by_spend` – Top N fournisseurs par spend avec payables/settlements ; `spendesk_get_purchase_orders_and_payables_export` – Export POs + payables d'une période, liés par fournisseur
- `spendesk_get_wallet_loads` / `spendesk_get_wallet_summary` – Recharges et résumé wallet. Voir [Export wallet loads → NetSuite](docs/export-wallet-loads-to-netsuite.md) pour le flow journalisation quotidienne.

### Analytical
- `spendesk_get_analytical_fields` / `spendesk_get_analytical_values` – Champs et valeurs analytiques (appeler d'abord `spendesk_get_analytical_fields` pour obtenir les `fieldId`, puis `spendesk_get_analytical_values` avec l'argument `fieldId`)
- `spendesk_get_cost_centers` / `spendesk_create_cost_center` / `spendesk_update_cost_center` / `spendesk_delete_cost_center` – Centres de coût
- `spendesk_get_expense_categories` – Catégories de dépenses

### Accounting
- `spendesk_get_journal_csv` – Contenu CSV d'un export comptable
- `spendesk_create_accounting_export` – Créer un export comptable
- `spendesk_get_journal_templates` – Modèles de journaux

### Suppliers & Users
- `spendesk_get_suppliers` / `spendesk_get_supplier` – Fournisseurs (filtres dédiés : `ids`, `updatedBefore/After`, `createdBefore/After`, `bankCountry`, `iban`, `vatNumber`, `isArchived`, + `filters` générique)
- `spendesk_create_suppliers` – Création fournisseurs (POST `/v1/suppliers`, corps = tableau d’objets `supplierToCreate` ; scope `experimental:supplier:manage`)
- `spendesk_update_supplier` / `spendesk_update_suppliers` / `spendesk_set_supplier_archive_status` – Mise à jour / archivage fournisseurs (PATCH)
- **Démo cycle de vie** : `node scripts/demo-supplier-lifecycle.mjs` (création → mise à jour → archivage ; puis 2 fournisseurs même TVA, filtre `vatNumber`, archivage du plus récent). Nécessite client credentials avec `experimental:supplier:manage` et `SPENDESK_USE_DEMO=true` si trunk sandbox.
- **Bulk suppliers (API directe)** : `node scripts/test-supplier-bulk-operations.mjs` — même flux que la collection Postman **`postman/Spendesk-Suppliers-Bulk.postman_collection.json`** (import + étapes : [`postman/README.md`](postman/README.md)).
- **Fiche fournisseur complète (tous champs OpenAPI + analyse lecture/patch)** : `node scripts/test-supplier-full-attributes.mjs` — rapport et tableau attributs : [`docs/supplier-full-attributes.md`](docs/supplier-full-attributes.md).
- **Purchase Orders (liste, détail, création, cancel, close)** : `node scripts/test-purchase-orders-api.mjs` — rapport : [`docs/purchase-orders-api-test.md`](docs/purchase-orders-api-test.md) ; Postman : [`postman/Spendesk-Purchase-Orders.postman_collection.json`](postman/Spendesk-Purchase-Orders.postman_collection.json) + [`postman/README.md`](postman/README.md).
- `spendesk_get_users` / `spendesk_get_user` – Utilisateurs (avec filtres via `filters`)

### Webhooks
- `spendesk_create_webhook` / `spendesk_get_webhooks` / `spendesk_get_webhook` / `spendesk_update_webhook` / `spendesk_delete_webhook` – Gestion des webhooks

### Purchase Orders
- `spendesk_get_purchase_orders` / `spendesk_create_purchase_order` – Commandes d’achat. Liste : filtres alignés sur [Get Purchase Orders](https://developer.spendesk.com/reference/v1-get-purchase-orders) (`supplierIds`, `status`, `companyIds`, `createdFrom`/`createdTo`, `startDateFrom`/`startDateTo`, `endDateFrom`/`endDateTo`, `withItems`, `filters`). Création : [Create a purchase order](https://developer.spendesk.com/reference/v1-create-purchase-order). Autres endpoints documentés dans `spendesk_get_api_reference` : [Get by ID](https://developer.spendesk.com/reference/v1-get-purchase-order), [Cancel](https://developer.spendesk.com/reference/v1-cancel-purchase-order), [Close](https://developer.spendesk.com/reference/v1-close-purchase-order).

### Ephemeral SQLite (analyses SQL)
- `spendesk_load_sqlite_data` – Charge un jeu (payables, settlements, suppliers, purchase_orders) dans une table SQLite en mémoire. Paramètres : `dataset`, `from_date`, `to_date` (obligatoires pour payables).
- `spendesk_execute_sql_query` – Exécute une requête SQL en lecture seule (SELECT ou WITH). Paramètre : `sql`. Résultats limités à 1000 lignes.
- `spendesk_list_loaded_tables` – Liste les tables chargées avec schéma (colonnes, types) et nombre de lignes.
- `spendesk_clear_sqlite_tables` – Supprime des tables (`table_names`) ou toutes si vide.

### Flows / Intégrations
- **[Export bank fees → NetSuite](docs/export-bank-fees-to-netsuite.md)** — Journalisation quotidienne des frais bancaires (otherFee / fxFee) en écritures comptables NetSuite, avec batching par jour et idempotence.
- **[Export wallet loads → NetSuite](docs/export-wallet-loads-to-netsuite.md)** — Journalisation des recharges wallet (virements bank → Spendesk) en écritures comptables NetSuite, une JE par load, avec idempotence et option `WALLET_LOAD_AMOUNT_UNIT` (cents vs EUR).

### Découverte / Référence API
- `spendesk_get_api_reference` – Retourne la **référence de l’API** : liste des endpoints (méthode HTTP, path), paramètres (query, path, body), nom de l’outil MCP associé, et champs **`documentation`** (liens [developer.spendesk.com](https://developer.spendesk.com/reference/general)) quand disponibles. Utiliser quand on demande « quels sont les endpoints ? », « quels paramètres pour les settlements ? », « filtres purchase orders », « structure de l’API ». Optionnel : `mcpTool` (ex. `spendesk_get_settlements`) ou `path` (ex. `payables`, `purchase-orders`) pour filtrer.

Les outils qui listent des éléments (settlements, suppliers, purchase orders, bank fees, wallet loads, etc.) acceptent une pagination explicite **`page`** (défaut 1) et **`perPage`**. Selon l’endpoint, le serveur mappe automatiquement vers le paramètre API attendu (`perPage` ou `pageSize`, ex. suppliers). Ils acceptent aussi des **filtres génériques** via le paramètre `filters` (objet avec n'importe quels query parameters de l'API Spendesk, ex. : `{ from: '2024-01-01', to: '2024-12-31', state: 'completed' }`). `spendesk_get_payables_snapshot` supporte également `page` et `perPage` pour paginer les payables d’un snapshot (ex. 1 177 payables sur ~40 pages à 30/page).

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

- **500 Internal Server Error**  
  Erreur **côté serveur Spendesk** (pas dans le MCP). Le serveur API a planté ou refuse la requête pour une raison interne. À faire :
  1. **Vérifier le token** : `SPENDESK_API_TOKEN` (ou le token fourni par le client via Bearer/client_credentials) doit être valide et avoir les scopes nécessaires (ex. accès Purchase Orders si tu appelles les POs).
  2. **Vérifier l’environnement** : en démo (`SPENDESK_USE_DEMO=true`), l’API démo peut ne pas supporter tous les endpoints (ex. purchase-orders).
  3. **Réessayer plus tard** : un 500 peut être temporaire (incident Spendesk). Réessayer après quelques minutes.
  4. **Regarder le détail** : depuis la dernière version, le message d’erreur inclut un extrait du corps de réponse de l’API (`Body: ...`) — cela peut indiquer la cause (ex. « feature not enabled », « invalid filter »).
  5. **Contacter Spendesk** : si l’erreur est reproductible sur un compte prod avec un token valide, ouvrir un ticket au support Spendesk avec l’endpoint, les paramètres et le message/corps de la réponse.

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
