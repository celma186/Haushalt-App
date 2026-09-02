-- Im Supabase SQL Editor ausführen (falls die Tabelle noch nicht existiert).

create table if not exists household_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- Realtime für diese Tabelle aktivieren (falls noch nicht geschehen):
alter publication supabase_realtime add table household_state;

-- Einfache offene Policy, da die App keinen Login hat und der anon key
-- clientseitig verwendet wird. Row Level Security aktivieren + freigeben:
alter table household_state enable row level security;

create policy "Allow all access to household_state"
  on household_state
  for all
  using (true)
  with check (true);
