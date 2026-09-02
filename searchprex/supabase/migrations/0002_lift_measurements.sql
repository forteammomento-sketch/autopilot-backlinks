-- Lift measurement, revised against the V0 implementation.
--
-- The original table stored cited_before/cited_after as booleans. That shape
-- cannot express the thing the measurement actually produces: each side is a
-- tally out of N attempts, because the engines answer the same prompt
-- differently each time. Collapsing 1-of-3 and 3-of-3 into one boolean would
-- throw away exactly the variance the 3x repeat exists to capture.

alter table lift_measurements
  drop column cited_before,
  drop column cited_after;

alter table lift_measurements
  add column action_type       text not null,
  add column prompt_id         uuid references prompts on delete cascade,
  add column engine            text not null,

  add column baseline_cited    smallint not null check (baseline_cited >= 0),
  add column baseline_total    smallint not null check (baseline_total >= 0),
  add column followup_cited    smallint check (followup_cited >= 0),
  add column followup_total    smallint check (followup_total >= 0),

  add column direction         text check (direction in
                                 ('gained', 'improved', 'unchanged', 'declined', 'lost')),

  -- True only for a complete flip: every attempt to none, or none to every.
  -- With three attempts a side, nothing weaker survives a significance test on
  -- its own -- a 0-of-3 to 2-of-3 move has a Fisher exact p near 0.4. The
  -- column exists so the UI cannot present a partial move as a proven win.
  add column confident         boolean not null default false,

  -- Control rows had no action deployed. They ride the same two weeks of
  -- engine reindexing, competitor publishing and unrelated site changes as the
  -- treated rows, so subtracting their movement is what separates our work
  -- from the drift. Without them a before/after chart is suggestive, not
  -- evidence.
  add column is_control        boolean not null default false,

  -- Set when a due measurement could not be taken: the pull request was never
  -- merged, or every engine call failed. Such a row is rescheduled, never
  -- recorded as a loss -- a false negative here would drag down the win rate
  -- for that action type across every customer.
  add column deferred_reason   text;

alter table lift_measurements
  add constraint followup_complete
    check ((followup_cited is null) = (followup_total is null));

create index on lift_measurements (action_type) where not is_control;
create index on lift_measurements (measured_at desc);

-- Win rates that feed the action ranker. Action types below the sample floor
-- are absent rather than optimistic: the ranker reads a missing rate as 0.5,
-- an explicit "no record yet", whereas 1.0 off three lucky deploys would push
-- that action type to the top of every queue on evidence indistinguishable
-- from chance.
create view action_win_rates as
select
  action_type,
  count(*)                                                    as sample,
  avg(case
        when followup_total > 0
         and baseline_total > 0
         and (followup_cited::numeric / followup_total)
           > (baseline_cited::numeric / baseline_total)
        then 1 else 0
      end)                                                    as win_rate
from lift_measurements
where not is_control
  and followup_total is not null
group by action_type
having count(*) >= 20;
