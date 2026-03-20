# Rapport de test — Purchase Orders (Spendesk Public API)

## Exécution automatique

```bash
node scripts/test-purchase-orders-api.mjs
```

- **Résultat JSON** : `purchase-orders-api-test-report.json` (racine du repo, gitignored).
- **Scopes** utiles : `experimental:purchase-order:read`, `experimental:purchase-order:write`, et pour enrichir le corps de création : `analytical-field:read` (+ listes users / cost centers / suppliers selon ton usage).
- **`PO_TEST_SKIP_MUTATIONS=1`** : uniquement `GET` liste + `GET` détail sur un PO de la réponse liste.
- **`PO_TEST_CANCEL_PO_ID`** / **`PO_TEST_CLOSE_PO_ID`** : forcent le test des routes cancel / close sans dépendre d’une création réussie (utiliser des PO **ouverts**, **jetables**, **distintcs**).

## Endpoints (référence)

| # | Méthode | Path | Scope |
|---|---------|------|--------|
| List | `GET` | `/v1/purchase-orders` | `experimental:purchase-order:read` |
| Create | `POST` | `/v1/purchase-orders` | `experimental:purchase-order:write` |
| Get by ID | `GET` | `/v1/purchase-orders/{purchaseOrderId}` | `experimental:purchase-order:read` |
| Cancel | `POST` | `/v1/purchase-orders/{purchaseOrderId}/cancel` | `experimental:purchase-order:write` |
| Close | `POST` | `/v1/purchase-orders/{purchaseOrderId}/close` | `experimental:purchase-order:write` |

Revoir les paramètres query (`page`, `pageSize`, `withItems`, filtres dates / statut) sur [Get Purchase Orders](https://developer.spendesk.com/reference/v1-get-purchase-orders).

## Contexte auto (script)

Sans `PO_TEST_*`, le script tente d’abord de lire **le 1er PO** (`GET /v1/purchase-orders?pageSize=1`) puis son détail pour réutiliser `requesterId`, `costCenterId`, `supplierId` — plus cohérent que de prendre seul le 1er `GET /v1/users` (souvent différent du requester affiché sur les PO).

## Résultats observés (trunk sandbox, 2026-03)

Exécution contre `https://beta-sandbox.api.trunk.spendesk.services` avec client credentials complets (read + write PO).

| Appel | HTTP | Commentaire |
|--------|------|-------------|
| `GET /v1/purchase-orders?page=1&pageSize=30` | **200** | OK — `data` + pagination. |
| `GET /v1/purchase-orders/{id}` | **200** | OK — PO existant (`open`). |
| `POST /v1/purchase-orders` (corps aligné OpenAPI : `userId`, `supplierId`, montants EUR, `costCenterId`, dates ISO, `customFieldAssociations` peuplé via champs analytiques + ligne `items`) | **500** | `INTERNAL_SERVER_ERROR` (message générique). |
| `POST /v1/purchase-orders/{id}/cancel` | **500** | Même erreur sur PO `open` (test avec ID explicite via `PO_TEST_CANCEL_PO_ID`). |
| `POST /v1/purchase-orders/{id}/close` | **500** | Idem (test avec `PO_TEST_CLOSE_PO_ID`). |

**Interprétation** : sur **cet** environnement trunk, les **lectures** Purchase Orders sont utilisables, mais les **écritures** testées (`POST` create, cancel, close) renvoient une **500** : à traiter comme **problème d’environnement / backend** plutôt que comme erreur de script (les chemins et corps suivent la doc publique). À reproduire sur `public-api.spendesk.com` ou sandbox Spendesk officiel si le comportement diffère.

Le rapport JSON détaille chaque étape (`steps[]`) et inclut jusqu’à 5 PO en statut `open` extraits de la liste (`openPurchaseOrdersSample`) pour faciliter des essais manuels Postman / curl.

## Création — corps minimal attendu (OpenAPI)

[Create a purchase order](https://developer.spendesk.com/reference/v1-create-purchase-order) exige notamment : `userId`, `amount`, `netAmount`, `costCenterId`, `startDate`, `endDate`, `customFieldAssociations`, et **`supplierId` ou `supplierName`**.

Montants en **plus petite unité** (ex. centimes pour EUR + `precision: 2`).

## Postman

Reprise des chemins ci-dessus. Auth : Bearer après `POST /v1/auth/token` (client credentials). Pour cancel/close : **POST** sans corps, ID dans le path, option `?withItems=true|false`.
