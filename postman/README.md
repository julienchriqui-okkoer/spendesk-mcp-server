# Postman — Spendesk Public API

Fichiers à importer dans Postman (Desktop ou Web) :

| Fichier | Rôle |
|---------|------|
| `Spendesk-Suppliers-Bulk.postman_collection.json` | Fournisseurs : auth + bulk create / patch / archive |
| `Spendesk-Purchase-Orders.postman_collection.json` | **Purchase Orders** : auth, discovery IDs, liste, détail, create, cancel, close |
| `Spendesk-Trunk-Sandbox.postman_environment.json` | Variables sandbox trunk (`base_url`, secrets, variables PO / suppliers) |
| `Spendesk-Production.postman_environment.json` | Variables prod (`https://public-api.spendesk.com`) |

## Purchase Orders — étapes

1. Importer **Spendesk-Purchase-Orders.postman_collection.json** + un environnement (trunk ou prod), renseigner `client_id` / `client_secret`.
2. **01 Auth** → remplit `access_token`.
3. Dossier **02 Discovery** (dans l’ordre) : Users → Cost centers → Suppliers → Analytical fields → Analytical values → remplit `po_user_id`, `po_cost_center_id`, `po_supplier_id`, `po_analytical_field_id`, `po_analytical_value_id`. **Note** : le premier utilisateur de `GET /v1/users` n’est pas toujours le `requesterId` d’un PO existant ; si la création échoue alors que les GET passent, compare avec le champ `requesterId` d’un **04 Get by ID** (le script `test-purchase-orders-api.mjs` auto-remplit à partir du 1er PO de la liste quand `PO_TEST_*` est absent).
4. **03 Liste** → remplit `po_id` (1er PO de la page) pour **04 Get by ID**.
5. **05 Create PO** (avec champs analytiques) ou **05b Create PO** (`customFieldAssociations: []`) → si **201**, la *Tests* script enregistre `po_id_last_created`.
6. **06 Cancel** / **07 Close** : renseigner **`po_id_cancel` et `po_id_close`** (deux OP **ouverts** jetables et distincts), ou remplacer dans l’URL par `{{po_id_last_created}}` pour un essai après création réussie. Réponses attendues souvent **200** avec `data.outcome` / `data.reason` (cf. doc Spendesk).

**Scopes** : `experimental:purchase-order:read` + `experimental:purchase-order:write` ; discovery : `user:read`, `cost-center:read`, `supplier:read`, `analytical-field:read`.

Sur certains environnements trunk, les **POST** create/cancel/close peuvent retourner **500** — les **GET** liste / détail restent utiles pour valider auth et scopes.

---

## Suppliers bulk — étapes

1. **Importer la collection** : *Import* → `Spendesk-Suppliers-Bulk.postman_collection.json`.
2. **Importer un environnement** (sandbox ou prod) : *Import* → `Spendesk-*.postman_environment.json` (réimporter si tu veux les nouvelles clés `po_*` pour la collection PO).
3. **Sélectionner l’environnement** dans la liste déroulante en haut à droite (ex. *Spendesk — Trunk sandbox*).
4. **Renseigner les secrets** dans l’environnement :
   - `client_id` / `client_secret` : même paire que dans ton `.env` (ex. `SPENDESK_CLIENT_ID_DEMO` / `SPENDESK_CLIENT_SECRET_DEMO` pour la trunk sandbox).
   - Ne commitez pas un environnement Postman contenant de vrais secrets.
5. **Exécuter dans l’ordre** (ou utiliser *Collection Runner* sur les 4 requêtes dans l’ordre) :
   - **01 Auth — Client credentials** → enregistre `access_token` via l’onglet *Tests*.
   - **02 Suppliers — Bulk create** → pré-remplit TVA + tag ; enregistre `supplier_id_1..3` et `supplier_ids_json`.
   - **03 Suppliers — Bulk patch** → met à jour les noms (utilise les mêmes IDs + `bulk_run_tag`).
   - **04 Suppliers — Bulk archive** → `PATCH /v1/experimental/suppliers/status` avec `supplierIds` + `isArchived: true`.

## Sans enchaînement automatique

- Si tu appelles **03** ou **04** sans avoir fait **02** dans la même session, renseigne manuellement `supplier_id_1`, `supplier_id_2`, `supplier_id_3` et mets `supplier_ids_json` au format JSON tableau, ex. `["id1","id2","id3"]`.

## Alternative : bearer fixe

Si tu as déjà un `access_token` (autre flux OAuth), tu peux le coller dans la variable `access_token` et sauter **01** (en vérifiant qu’il n’est pas expiré).

## Scopes

Les mutations suppliers (dont bulk) nécessitent les scopes adaptés côté application Spendesk, ex. `experimental:supplier:manage` sur l’environnement expérimental.
