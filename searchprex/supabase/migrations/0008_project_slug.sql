-- Readable project URLs.
--
-- Routes are /p/<slug>. Until now that was a fixture string; with more than one
-- tenant it has to resolve to a real project, and a UUID in the address bar is
-- both ugly and a small information leak about row ordering.
--
-- Unique globally rather than per organisation: the slug appears in a URL with
-- no org segment in front of it, so two orgs holding the same slug would make
-- the route ambiguous — and resolving it by guessing is how one tenant ends up
-- looking at another's dashboard.

alter table projects add column slug text;

update projects
   set slug = regexp_replace(
     regexp_replace(lower(domain), '^www\.', ''),
     '[^a-z0-9]+', '-', 'g')
 where slug is null;

-- Break ties left by the backfill before the unique index goes on.
with numbered as (
  select id, slug, row_number() over (partition by slug order by created_at, id) as n
  from projects
)
update projects p
   set slug = p.slug || '-' || numbered.n::text
  from numbered
 where p.id = numbered.id and numbered.n > 1;

alter table projects alter column slug set not null;
create unique index projects_slug_key on projects (slug);
