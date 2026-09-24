-- ============================================================================
-- 20260924001000_repair_double_encoded_evidence.sql
--
-- Data repair, no schema change. Before the API cast JSON parameters as
-- `$n::text::jsonb`, postgres.js JSON-encoded an already-serialized value a
-- second time, so `actions.evidence` could be stored as a JSON *string*
-- instead of an object. One such row exists in the dev project, created by a
-- direct store probe during end-to-end testing. The API cannot parse it
-- (ActionSchema.evidence is an object), so it would fail its creator's
-- action list.
--
-- Removes only actions whose evidence is not a JSON object; their
-- action_events rows cascade. Audit rows are append-only and are kept.
-- ============================================================================

delete from orbit.actions where jsonb_typeof(evidence) <> 'object';
