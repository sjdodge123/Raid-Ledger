-- Custom SQL migration file, put your code below! ---- ROK-1670 L2/L3: the catalogue epoch is data, set once at migration time
-- (UTC ISO-8601, e.g. 2026-09-23T00:00:00Z). It changes only on a deliberate
-- catalogue reset; ON CONFLICT keeps a restored value.
INSERT INTO "hub_meta" ("key", "value")
VALUES ('catalog_epoch', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT ("key") DO NOTHING;
