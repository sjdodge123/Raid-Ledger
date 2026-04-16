-- ROK-948: Enable the pgvector extension so player_taste_vectors (added in a
-- later migration) can use the vector(7) column type for cosine-similarity
-- queries. Extension is trusted (v0.5.0+), so any role with CREATE on the
-- database — including the raid_ledger app role — can install it.
CREATE EXTENSION IF NOT EXISTS vector;
