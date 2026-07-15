-- 0007_sample_data — sample catalog tagging (1E, FR-10.1). Seeded onboarding
-- products carry a sample_batch_id so a one-click purge removes exactly that
-- batch and nothing the owner created. Nullable everywhere so real catalog rows
-- are unaffected. Partial indexes keep purge cheap. The columns live on tables
-- that are already RLS-protected, so no new policy or grant is needed.
ALTER TABLE products ADD COLUMN sample_batch_id text;
ALTER TABLE variants ADD COLUMN sample_batch_id text;
ALTER TABLE categories ADD COLUMN sample_batch_id text;
ALTER TABLE inventory_levels ADD COLUMN sample_batch_id text;

CREATE INDEX products_sample_batch_idx ON products (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
CREATE INDEX variants_sample_batch_idx ON variants (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
CREATE INDEX categories_sample_batch_idx ON categories (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
CREATE INDEX inventory_levels_sample_batch_idx ON inventory_levels (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
