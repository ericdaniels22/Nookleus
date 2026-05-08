# Build 15d Pre-flight Capture — 2026-05-06

> Scratch capture for Task 1 of the build 15d plan. **Uncommitted** — referenced by Task 4 migration body, then deleted at end of build.

## Query 1: contract_templates columns (current state)

| column_name | data_type | nullable | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | — |
| description | text | YES | — |
| content | jsonb | NO | `'{"type": "doc", "content": []}'::jsonb` |
| content_html | text | NO | `''::text` |
| default_signer_count | integer | NO | 1 |
| signer_role_label | text | NO | `'Homeowner'::text` |
| is_active | boolean | NO | true |
| version | integer | NO | 1 |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| organization_id | uuid | NO | — |

**No partial-15d columns present.** Migration in Task 4 drops `content` + `content_html` + `default_signer_count`; adds `pdf_storage_path` + `pdf_page_count` + `pdf_pages` + `overlay_fields` + `signer_count`. Other columns retained verbatim.

## Query 2: template counts per org

| organization_id | templates | active |
|---|---|---|
| a0000000-0000-4000-8000-000000000002 (Test Co) | 1 | 1 |
| a0000000-0000-4000-8000-000000000001 (AAA) | 3 | 3 |

4 templates total. AAA's 3 active templates lose Tiptap content on migration — Eric re-uploads source PDFs post-deploy. Test Co's single template is the §11 fixture target.

## Query 3: in-flight contracts (orphan risk)

| organization_id | open | active_links |
|---|---|---|
| a0000000-0000-4000-8000-000000000001 (AAA) | 4 | NULL |

**`active_links` is NULL** — no `(sent|viewed)` contracts with `link_expires_at > NOW()`. The 4 open contracts are at status `draft` (or have already-expired links). **No Eric reconciliation needed; safe to proceed with migration.**

## Query 4: contract_signers FK + signature_image_path layout

```sql
PRIMARY KEY (id)
FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
```

Sample `signature_image_path` prefixes:

```
0358ccab-1b95-43df-ad2a-91cc2e7e80e1/1f20d67d-93e6-41fc-9860-468badd37bfd/signatures
0358ccab-1b95-43df-ad2a-91cc2e7e80e1/1ab7ff32-e133-4df4-9fa4-5078472177f1/signatures
1fffe25c-090f-4320-bad2-f3eaaaa6e479/07bf6a18-f5c6-4708-91ba-2d44f6780f9e/signatures
```

Layout: `{org_id}/{contract_id}/signatures/{signer_id}.png` — three-level nesting.

For consistency, the new `contract-pdfs` bucket layout uses:
- Source template PDFs: `{org_id}/templates/{template_id}.pdf`
- Stamped signed contracts: `{org_id}/contracts/{contract_id}-signed.pdf`

(Flat under `{org_id}/contracts/` rather than nested per contract — only one stamped artifact per contract row, vs. one signature image per signer.)

## Decision: PROCEED

All four checks pass. No partial-15d state. No active signing links. Schema at expected pre-15d shape. Migration in Task 4 is safe to apply.
