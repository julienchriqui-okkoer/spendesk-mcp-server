# Fournisseur : attributs create / read / patch (Spendesk Public API)

Référence OpenAPI : [`supplierToCreate`](https://developer.spendesk.com/reference/v1-create-suppliers), [`supplier` (GET)](https://developer.spendesk.com/reference/v1-get-supplier-by-id), [`supplierToUpdateSingle`](https://developer.spendesk.com/reference/v1-update-supplier).

## Script de test

```bash
node scripts/test-supplier-full-attributes.mjs
```

- Utilise le `.env` du projet (client credentials, même logique que les autres scripts).
- En cas de **429**, le script retente automatiquement avec backoff.
- Produit `supplier-full-attributes-report.json` à la racine du repo (fichier gitignored).
- Variable optionnelle : `FULL_SUPPLIER_TEST_CHANGE_IBAN_PATCH=1` — PATCH avec un **nouvel** IBAN (sinon IBAN inchangé, scénario stable).

## Cartographie écriture → lecture

| Envoi (POST/PATCH body) | Lecture `GET /v1/suppliers/:id` | Comportement observé (trunk sandbox, 2026-03) |
|---------------------------|-----------------------------------|-----------------------------------------------|
| `name` | `name` | OK |
| `primaryEmail` | `primaryEmail` | Souvent **absent ou vide** en lecture malgré écriture OK |
| `supplierDetails.legalName` | `legalName` | OK |
| `supplierDetails.registrationNumber` | `registrationNo` | OK ; **casse** possible (normalisation majuscules) |
| `supplierDetails.vatNumber` | `vatNo` | OK |
| `supplierDetails.address` | `address.line1` | OK (y compris sauts de ligne dans la chaîne) |
| `supplierDetails.city` | `address.city` | OK |
| `supplierDetails.zipcode` | `address.postalCode` | OK |
| `supplierDetails.country` | `address.country` | OK |
| `bankInfo.iban` | `iban` **(racine)** | OK ; l’objet `bankInfo` est souvent **vide** en GET |
| `bankInfo.bic` | `bic` **(racine)** | idem |
| `bankInfo.bankCountry` | `bankCountry` **(racine)** | idem |
| `bankInfo.accountNumber` | `bankInfo.accountNumber` | **Non visible** en GET dans nos tests ; **PATCH avec ce champ → HTTP 500** sur trunk |
| `bankInfo.routingNumber` | — | Non vérifié en GET ; **PATCH seul → HTTP 500** sur trunk |
| `bankInfo.sortCode` | — | idem |
| `bankInfo.accountHolderName` | `bankInfo.accountHolderName` | Écriture semble OK ; **pas renvoyé** dans l’objet `bankInfo` du GET (racine sans équivalent) |

## Synthèse « ce qui ne va pas » côté intégration

1. **`primaryEmail`** : ne pas s’appuyer sur `GET` pour valider l’email ; prévoir autre source ou accepter l’opacité du read model.
2. **`bankInfo` imbriqué en GET** : utiliser **`iban` / `bic` / `bankCountry` à la racine** pour l’affichage et les contrôles.
3. **Champs banque « secondaires »** (`accountNumber`, `routingNumber`, `sortCode`, `accountHolderName`) : **pas exposés** de façon fiable sur `GET` dans nos essais ; le script les note comme « persistance non vérifiable via GET ».
4. **PATCH `bankInfo.accountNumber`** : **HTTP 500** sur l’environnement trunk testé — à traiter comme limitation / bug sandbox à remonter à Spendesk.
5. **PATCH `routingNumber` / `sortCode`** : **HTTP 500** dans les tests (probable incohérence pays banque vs format US/UK).

## OpenAPI

Seuls les champs listés dans `supplierToCreate` existent côté contrat ; **`additionalProperties: false`** : tout champ inconnu ferait échouer la validation côté serveur.
