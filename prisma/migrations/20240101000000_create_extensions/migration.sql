
BEGIN;

-- Create extensions if they don't exist
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Verify creation (optional, for debugging)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        RAISE EXCEPTION 'Failed to create postgis extension';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        RAISE EXCEPTION 'Failed to create pg_trgm extension';
    END IF;
    
    RAISE NOTICE 'Extensions created successfully';
END $$;

COMMIT;