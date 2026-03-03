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

---

## Monitoring MCP – Requêtes d’usage suggérées

Base : table `mcp_usage_events` (voir schéma SQLite).

### Volume global par jour

```sql
SELECT
  substr(ts, 1, 10) AS day,
  COUNT(*) AS total_events
FROM mcp_usage_events
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

### Top tools utilisés

```sql
SELECT
  tool_name,
  category,
  COUNT(*) AS calls
FROM mcp_usage_events
WHERE tool_name IS NOT NULL
GROUP BY tool_name, category
ORDER BY calls DESC
LIMIT 20;
```

### Taux d’erreur par tool

```sql
SELECT
  tool_name,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
  COUNT(*) AS total,
  ROUND(100.0 * errors / total, 2) AS error_rate_pct
FROM mcp_usage_events
WHERE tool_name IS NOT NULL
GROUP BY tool_name
HAVING total >= 10
ORDER BY error_rate_pct DESC;
```

### Latence moyenne par catégorie

```sql
SELECT
  category,
  COUNT(*) AS calls,
  ROUND(AVG(duration_ms), 1) AS avg_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 1) AS p95_ms
FROM mcp_usage_events
WHERE duration_ms IS NOT NULL
GROUP BY category
ORDER BY avg_ms DESC;
```

*(Si SQLite ne supporte pas `PERCENTILE_CONT`, remplacer par un approximation ou ignorer la colonne p95.)*

### Usage par client (hash)

```sql
SELECT
  client_hash,
  COUNT(*) AS calls
FROM mcp_usage_events
WHERE client_hash IS NOT NULL
GROUP BY client_hash
ORDER BY calls DESC
LIMIT 50;
```

### Alertes simples (exemples de seuils)

- **Taux d’erreur > 5 %** sur les 15 dernières minutes :

```sql
SELECT
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
  COUNT(*) AS total,
  ROUND(100.0 * errors / total, 2) AS error_rate_pct
FROM mcp_usage_events
WHERE ts >= datetime('now', '-15 minutes');
```

- **Volume > 500 appels** sur les 15 dernières minutes :

```sql
SELECT
  COUNT(*) AS total
FROM mcp_usage_events
WHERE ts >= datetime('now', '-15 minutes');
```

**Légende:** ✅ OK = succès, ❌ = erreur. Count = nombre d’éléments retournés.