# Export wallet loads to NetSuite as journal entries

This document describes how to use the Spendesk MCP (`spendesk_get_wallet_loads`) together with a NetSuite MCP to journalize wallet top-ups daily in NetSuite. Wallet loads are **internal treasury movements** (bank → Spendesk wallet); no supplier is involved, so they are **journal entries**, not vendor bills.

## Context

- `spendesk_get_wallet_loads` returns wallet top-ups (e.g. `wireTransfer` from "sfs").
- These are bank → Spendesk wallet movements.
- No supplier → journal entries only.
- One journal entry **per load** (idempotency by `externalId`: `spk_walletload_<loadId>`).

## Step 1c — Wallet loads for the day (agent instructions)

After Step 1b (bank fees), the agent should:

1. **Fetch yesterday’s wallet loads**
   - Call: `spendesk_get_wallet_loads(filters: { createdFrom: "<yesterday>", createdTo: "<yesterday>" })`
   - Use ISO date (YYYY-MM-DD) for yesterday. If the API expects different param names (e.g. `createdAfter` / `createdBefore`), use `spendesk_get_api_reference({ path: "wallet-loads" })` to confirm.

2. **For each load**
   - **Idempotency:** Check NetSuite for an existing journal entry with `externalId = "spk_walletload_<loadId>"`.
     - Call: `netsuite_get_journal_entry_by_external_id(externalId: "spk_walletload_<loadId>")`
     - If `found: true`, skip this load.
   - **Amount:** Use `load.amount`. Confirm unit with client (see [WALLET_LOAD_AMOUNT_UNIT](#client_configwallet_load_amount_unit) below). If the API returns **cents**, divide by 100 before sending to NetSuite.
   - **Create journal entry** (see shape below).

### Journal entry shape (one per load)

```
netsuite_create_journal_entry(
  subsidiary: DEFAULT_SUBSIDIARY,
  tranDate:   <date part of load.createdAt>,
  memo:       "Spendesk wallet load | <load.type> | <load.bankName>",
  externalId: "spk_walletload_<loadId>",
  line: [
    { account: CLIENT_CONFIG.ACCOUNTS.spendeskWallet.id, debit:  <amount in journal currency> },
    { account: CLIENT_CONFIG.ACCOUNTS.bankAccount.id,    credit: <amount in journal currency> }
  ]
)
```

- **spendeskWallet** (debit): increase wallet balance.
- **bankAccount** (credit): decrease bank balance.
- Use `CLIENT_CONFIG.ACCOUNTS` from [example-netsuite-accounts.json](../config/example-netsuite-accounts.json) (same as bank fees flow).

## CLIENT_CONFIG.WALLET_LOAD_AMOUNT_UNIT

Confirm with the client by checking a known load against the NetSuite bank statement.

| Value   | Meaning |
|--------|---------|
| `"cents"` | API returns amounts in **cents** → divide by 100 before creating the journal entry. |
| `"eur"`   | API returns amounts in **EUR** (or major units) → use as-is. |

Add to your integration config:

```json
"WALLET_LOAD_AMOUNT_UNIT": "cents"
```

Set to `"eur"` if amounts are already in major units. If unsure, default to `"cents"` and validate with one load.

## NetSuite MCP tool

Same as for bank fees: the NetSuite MCP must expose `netsuite_get_journal_entry_by_external_id(externalId)` for idempotency checks. See [export-bank-fees-to-netsuite.md](export-bank-fees-to-netsuite.md#netsuite-mcp-tool-required-netsuite_get_journal_entry_by_external_id).
