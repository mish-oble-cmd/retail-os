-- 1F: every store gets the fixed Cashier role (signup seeds it from now on).
DO $$
DECLARE
  s RECORD;
  alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  new_id TEXT;
  i INT;
BEGIN
  FOR s IN
    SELECT st.id AS store_id FROM stores st
    WHERE NOT EXISTS (
      SELECT 1 FROM roles r WHERE r.store_id = st.id AND r.name = 'Cashier'
    )
  LOOP
    new_id := '';
    FOR i IN 1..26 LOOP
      new_id := new_id || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    END LOOP;
    INSERT INTO roles (id, store_id, name, permissions)
    VALUES (new_id, s.store_id, 'Cashier', '{"cashier": true, "max_discount_pct": 10}'::jsonb);
  END LOOP;
END $$;
