# Rapport QA – Endpoints de liste (5 derniers éléments)

- **Date:** 2026-02-14T22:10:37
- **Base URL:** https://beta-sandbox.api.trunk.spendesk.services
- **Limit:** 5

| Endpoint | API directe | Count API | MCP | Count MCP |
|---------|-------------|-----------|-----|-----------|
| `/v1/settlements` | ✅ OK | 30 | ✅ OK | 30 |
| `/v1/bank-fees` | ✅ OK | 2 | ✅ OK | 2 |
| `/v1/wallet-loads` | ✅ OK | 6 | ✅ OK | 6 |
| `/v1/analytical-fields` | ✅ OK | 6 | ✅ OK | 6 |
| `/v1/analytical-fields/{fieldId}/values` | ✅ OK | 23 | ✅ OK | 23 |
| `/v1/cost-centers` | ✅ OK | 7 | ✅ OK | 7 |
| `/v1/expense-categories` | ✅ OK | 26 | ✅ OK | 26 |
| `/v1/suppliers` | ✅ OK | 30 | ✅ OK | 30 |
| `/v1/users` | ✅ OK | 27 | ✅ OK | 27 |
| `/v1/webhooks/instances` | ❌ The requested resource cannot be found. | 0 | ✅ OK | 0 |
| `/v1/purchase-orders` | ✅ OK | 30 | ✅ OK | 30 |

---
**Résumé**
- **API directe :** 10/11 OK. 1 échec : webhooks/instances (NOT_FOUND sur cette sandbox).
- **MCP :** 11/11 OK.
- **Analytical :** test sur `GET /v1/analytical-fields` (liste des champs) et sur `GET /v1/analytical-fields/{fieldId}/values` (valeurs d’un champ).

**Légende:** ✅ OK = succès, ❌ = erreur. Count = nombre d’éléments retournés.