ALTER TABLE previews ADD COLUMN publication_mode text NOT NULL DEFAULT 'TEMPORARY';
ALTER TABLE previews ADD COLUMN slug text;
ALTER TABLE previews ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE previews ADD CONSTRAINT previews_publication_mode_ck CHECK (publication_mode IN ('TEMPORARY', 'PERMANENT'));
ALTER TABLE previews ADD CONSTRAINT previews_publication_fields_ck CHECK (
 (publication_mode = 'TEMPORARY' AND slug IS NULL AND expires_at IS NOT NULL) OR
 (publication_mode = 'PERMANENT' AND slug IS NOT NULL AND expires_at IS NULL)
);
ALTER TABLE previews ADD CONSTRAINT previews_slug_format_ck CHECK (slug IS NULL OR (length(slug) BETWEEN 3 AND 40 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));
CREATE UNIQUE INDEX previews_slug_unique_idx ON previews (slug) WHERE slug IS NOT NULL;

-- Serialize permanent promotions per owner across all app instances.
-- The owner row lock is held until the transaction commits.
CREATE FUNCTION enforce_permanent_preview_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.publication_mode = 'PERMANENT' AND OLD.publication_mode <> 'PERMANENT' THEN
    PERFORM 1 FROM users WHERE id = NEW.owner_user_id FOR UPDATE;
    IF (SELECT count(*) FROM previews
        WHERE owner_user_id = NEW.owner_user_id
          AND publication_mode = 'PERMANENT'
          AND status = 'READY') >= 10 THEN
      RAISE EXCEPTION 'PERMANENT_PREVIEW_LIMIT'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER permanent_preview_limit_trigger
BEFORE UPDATE OF publication_mode ON previews
FOR EACH ROW EXECUTE FUNCTION enforce_permanent_preview_limit();
