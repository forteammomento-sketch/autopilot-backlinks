-- Third-party connections, one per provider per project.
--
-- A refresh token is a permanent key to someone's Search Console. It is stored
-- encrypted at the application layer, so the database on its own is not enough:
-- every backup, read replica and stray `select *` holds ciphertext, and the key
-- lives in the process environment instead of in the data.

create table connections (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects on delete cascade,
  provider             text not null check (provider in ('google_search_console')),

  -- AES-256-GCM, base64(iv | tag | ciphertext). Never plaintext, never logged.
  refresh_token_sealed text not null,
  scope                text not null,

  -- The chosen property. `sc-domain:example.com` and `https://example.com/` are
  -- different properties with different data, so which one was picked is part
  -- of the connection rather than something inferred later.
  site_url             text,
  account_email        text,

  connected_at         timestamptz not null default now(),
  last_used_at         timestamptz,

  -- One live connection per provider per project. Re-connecting replaces it,
  -- which is what a customer expects from pressing Connect again.
  unique (project_id, provider)
);

create index on connections (project_id);

alter table connections enable row level security;

-- Read-only through RLS, and deliberately never exposing the sealed token to a
-- browser session: only server-side code holding the service-role key and the
-- encryption key can use it.
create policy connection_read on connections for select
  using (project_id in (select id from projects));

create view v_connections as
select
  id,
  project_id,
  provider,
  scope,
  site_url,
  account_email,
  connected_at,
  last_used_at
from connections;
