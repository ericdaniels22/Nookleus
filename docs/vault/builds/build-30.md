---
build_id: 30
title: Job files section
status: shipped
phase: jobs
started: null
shipped: null
guide_doc: null
handoff: null
related: ["[[build-1-10]]", "[[build-31]]"]
---

#status/shipped #area/jobs #build/30

## What shipped

A "Files" section on the job-detail page — sibling to Photos, but for arbitrary documents (contracts, estimates, invoices, PDFs, spreadsheets, etc.).

- **Migration:** [supabase/migration-build30-job-files.sql](../../../supabase/migration-build30-job-files.sql) — `job_files` table (id, job_id, filename, storage_path, size_bytes, mime_type), index on `(job_id, created_at DESC)`, private `job-files` storage bucket.
- **Routes:** `/api/jobs/[id]/files` (list, upload, rename, delete), signed-URL endpoint.
- **Components:** [src/components/job-files.tsx](../../../src/components/job-files.tsx), [src/components/job-file-preview.tsx](../../../src/components/job-file-preview.tsx).
- **Bucket policy:** matches email-attachments — permissive (API routes are the only caller).

## Source

- Commit range: `7bf0ed6` (db) → `9d0a0e4` (UI mount)
- Migration: [supabase/migration-build30-job-files.sql](../../../supabase/migration-build30-job-files.sql)
- Guide: none
