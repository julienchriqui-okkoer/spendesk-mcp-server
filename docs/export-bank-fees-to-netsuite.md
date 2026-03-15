# Export bank fees to NetSuite as journal entries

This document describes how to use the Spendesk MCP (`spendesk_get_bank_fees`) together with a NetSuite MCP to journalize bank fees daily in NetSuite. Bank fees are **not** vendor bills (no supplier); they are platform fees and FX fees linked to settlements.

## Context

- `spendesk_get_bank_fees` returns fees with two kinds:
  - **otherFee** — platform fee charged per transaction → account 627800 (Services bancaires)
  - **fxFee** — FX conversion fee (e.g. 2% on foreign currency) → account 656000 (Pertes de change)
- Each fee is linked to a `settlementId` for reconciliation.
- Fees must be journalized **daily**, grouped **by day and by kind** (one journal entry per day for all otherFees, one per day for all fxFees) for performance.

## Step 1b — Bank fees for the day (agent instructions)

After processing settlements, the agent should:

1. **Fetch yesterday’s bank fees**
   - Call: `spendesk_get_bank_fees(chargedFrom: "<yesterday>", chargedTo: "<yesterday>")`
   - Use ISO date (YYYY-MM-DD) for yesterday.

2. **Group by kind**
   - Group results by `kind`: `fxFee` | `otherFee`.

3. **Idempotency**
   - For the **batch** of the day (per kind), check if a NetSuite journal entry already exists:
     - Use a single externalId per day+kind, e.g. `spk_bankfee_otherFee_<YYYY-MM-DD>` and `spk_bankfee_fxFee_<YYYY-MM-DD>`.
   - Call: `netsuite_get_journal_entry_by_external_id(externalId: "spk_bankfee_otherFee_<date>")` (and same for fxFee).
   - If `found: true`, skip creation for that day+kind.

4. **Create one journal entry per day per kind (batched)**
   - Sum all `otherFee` amounts for the day → one journal entry.
   - Sum all `fxFee` amounts for the day → one journal entry.
   - Memo: list settlement IDs (e.g. first 5 + “…” if many) for traceability.

### Journal entry shape (batched by day)

**otherFee (one JE for all otherFees of the day):**

```
netsuite_create_journal_entry(
  subsidiary: DEFAULT_SUBSIDIARY,
  tranDate:   "<YYYY-MM-DD>",
  memo:       "Spendesk bank fees | settlements: <id1>, <id2>, …",
  externalId: "spk_bankfee_otherFee_<YYYY-MM-DD>",
  line: [
    { account: CLIENT_CONFIG.ACCOUNTS.bankFees.id,     debit:  <totalOtherFeeAmount> },
    { account: CLIENT_CONFIG.ACCOUNTS.spendeskWallet.id, credit: <totalOtherFeeAmount> }
  ]
)
```

**fxFee (one JE for all fxFees of the day):**

```
netsuite_create_journal_entry(
  subsidiary: DEFAULT_SUBSIDIARY,
  tranDate:   "<YYYY-MM-DD>",
  memo:       "Spendesk FX fees | settlements: <id1>, <id2>, …",
  externalId: "spk_bankfee_fxFee_<YYYY-MM-DD>",
  line: [
    { account: CLIENT_CONFIG.ACCOUNTS.fxLoss.id,        debit:  <totalFxFeeAmount> },
    { account: CLIENT_CONFIG.ACCOUNTS.spendeskWallet.id, credit: <totalFxFeeAmount> }
  ]
)
```

## CLIENT_CONFIG.ACCOUNTS example

Use these account mappings in your NetSuite integration config. Replace `TO_CONFIRM` with actual NetSuite internal IDs for your subsidiary.

```json
{
  "ACCOUNTS": {
    "bankFees":       { "id": "371",   "code": "627800", "name": "Services bancaires" },
    "fxLoss":         { "id": "TO_CONFIRM", "code": "656000", "name": "Pertes de change" },
    "fxGain":         { "id": "TO_CONFIRM", "code": "766000", "name": "Gains de change" },
    "spendeskWallet": { "id": "TO_CONFIRM", "code": "58xxxx", "name": "Compte Spendesk (virement interne)" },
    "bankAccount":    { "id": "1812",  "code": "512451", "name": "SPENDESK SAS PROD FS" },
    "ap":             { "id": "TO_CONFIRM", "code": "401000", "name": "Fournisseurs" }
  }
}
```

A full example file is in [../config/example-netsuite-accounts.json](../config/example-netsuite-accounts.json).

## NetSuite MCP tool required: netsuite_get_journal_entry_by_external_id

The **NetSuite MCP** (separate from this Spendesk MCP) must expose a tool for idempotency checks:

- **Name:** `netsuite_get_journal_entry_by_external_id`
- **Input:** `{ externalId: string }`
- **Behavior:** Query NetSuite for a journal entry whose `externalId` equals the given value (e.g. `GET /services/rest/record/v1/journalEntry?q=externalId IS "<externalId>"` or equivalent).
- **Output:**
  ```ts
  { found: boolean, entry: JournalEntry | null }
  ```
  - `found: true` and `entry` set if one record exists; `found: false` and `entry: null` otherwise.

Same pattern as `netsuite_get_vendor_bill_by_external_id`: one query by externalId, return at most one record.

## Important: batch by day, not one JE per fee

- **Do not** create one journal entry per bank fee (would create thousands of JEs).
- **Do** aggregate all `otherFee` of the day into one journal entry and all `fxFee` of the day into one journal entry.
- Use a single externalId per day+kind (e.g. `spk_bankfee_otherFee_2026-02-27`) so the idempotency check is one call per kind per day.
