-- build76 (issue #76): make contracts.template_id nullable and change its
-- foreign key to ON DELETE SET NULL.
--
-- Backs the new "Permanently delete contract templates" feature. A signed
-- contract is already saved as its own stamped PDF (contracts.signed_pdf_path)
-- and no longer depends on its source template. When an org admin hard-deletes
-- a template, surviving terminal contracts (signed / expired / voided) must be
-- retained — they keep their row, their stamped PDF stays downloadable, and a
-- signed contract's original signing link still serves the document.
--
-- The build33 inline definition was:
--   template_id uuid NOT NULL REFERENCES contract_templates(id)
-- which auto-named the FK `contracts_template_id_fkey` with NO ACTION on
-- delete — deleting a referenced template would FK-error. This migration:
--   * drops NOT NULL so a surviving contract can have a null template_id;
--   * recreates the FK with ON DELETE SET NULL so the delete nulls the
--     column on terminal contracts instead of failing.
--
-- The hard_delete_contract_template RPC (build76 RPC migration) deletes
-- `draft` referencing contracts outright and is the authoritative gate that
-- refuses the delete while a `sent` / `viewed` contract still references the
-- template. By the time the template row is deleted, the only contracts that
-- still point at it are terminal, and the FK SET NULL clears their column.

ALTER TABLE public.contracts
  ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE public.contracts
  DROP CONSTRAINT contracts_template_id_fkey;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES public.contract_templates(id)
    ON DELETE SET NULL;

-- ROLLBACK ---
-- ALTER TABLE public.contracts
--   DROP CONSTRAINT contracts_template_id_fkey;
--
-- ALTER TABLE public.contracts
--   ADD CONSTRAINT contracts_template_id_fkey
--     FOREIGN KEY (template_id) REFERENCES public.contract_templates(id);
--
-- -- Only re-add NOT NULL if no contract rows have a null template_id:
-- ALTER TABLE public.contracts
--   ALTER COLUMN template_id SET NOT NULL;
