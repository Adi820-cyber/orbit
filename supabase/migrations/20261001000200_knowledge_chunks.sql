-- Enable pgvector (Supabase includes the extension)
create extension if not exists vector with schema extensions;

-- ──────────────────────────────────────────────────────────────────────────────
-- Knowledge chunks: organisation-scoped, role-filtered context for RAG.
--
-- Each chunk may be restricted to a set of roles (visible_roles) and optionally
-- scoped to an entity (grain + id). An empty visible_roles means all leader
-- roles in the organisation may see it.
--
-- The embedding column uses 1536 dimensions (text-embedding-3-small standard).
-- ──────────────────────────────────────────────────────────────────────────────
create table orbit.knowledge_chunks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orbit.organizations(id),
  -- Which leader roles may see this chunk. '{}' = all roles.
  visible_roles   text[] not null default '{}',
  -- Optional entity-level scoping
  entity_grain    text check (entity_grain in ('group', 'region', 'facility', 'coe')),
  entity_id       uuid,
  -- Content
  title           text not null,
  content         text not null,
  source          text not null default 'manual',
  -- The vector
  embedding       extensions.vector(1536),
  created_at      timestamptz not null default now()
);

comment on table orbit.knowledge_chunks is
  'RAG context chunks, scoped by organisation, role, and optional entity.';

-- IVFFlat index for cosine similarity search
create index knowledge_chunks_embedding_idx
  on orbit.knowledge_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

-- Organisation index for the most common filter
create index knowledge_chunks_org_idx
  on orbit.knowledge_chunks (organization_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS: a member sees only their own organisation's chunks, filtered by role.
-- ──────────────────────────────────────────────────────────────────────────────
alter table orbit.knowledge_chunks enable row level security;

create policy knowledge_chunks_select_own_org
  on orbit.knowledge_chunks
  for select to orbit_app
  using (
    organization_id = (current_setting('orbit.membership', true)::jsonb ->> 'organizationId')::uuid
    and (
      visible_roles = '{}'
      or (current_setting('orbit.membership', true)::jsonb ->> 'role') = any(visible_roles)
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC: scoped vector match
--
-- Returns the top-N chunks by cosine similarity, filtered by the caller's
-- organisation, role (via RLS), and optionally an entity grain/id. The caller
-- passes the verified claims through set_config before calling, so RLS does the
-- role filtering.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function orbit.match_knowledge(
  query_embedding  extensions.vector(1536),
  match_threshold  float default 0.75,
  match_count      int   default 5,
  p_entity_grain   text  default null,
  p_entity_id      uuid  default null
)
returns table (
  id         uuid,
  title      text,
  content    text,
  source     text,
  similarity float
)
language sql stable
security invoker  -- runs as orbit_app, RLS applies
as $$
  select
    k.id,
    k.title,
    k.content,
    k.source,
    1 - (k.embedding <=> query_embedding) as similarity
  from orbit.knowledge_chunks k
  where
    -- Entity-level scoping: if the caller asks for a specific entity, only
    -- return chunks that are unscoped OR scoped to that entity.
    (p_entity_grain is null or k.entity_grain is null or k.entity_grain = p_entity_grain)
    and (p_entity_id is null or k.entity_id is null or k.entity_id = p_entity_id)
    and 1 - (k.embedding <=> query_embedding) > match_threshold
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

comment on function orbit.match_knowledge is
  'Cosine-similarity search over knowledge_chunks, filtered by RLS (org + role) and optional entity scope.';

-- Grant execute to the application role
grant execute on function orbit.match_knowledge to orbit_app;
