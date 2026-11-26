-- EventPass / Supabase PostgreSQL schema
-- Ejecutar una sola vez desde Supabase Dashboard > SQL Editor.
-- La emisión segura de tickets/firmas debe realizarse en backend o Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Usuario EventPass',
  role text not null default 'attendee' check (role in ('admin', 'organizer', 'staff', 'attendee')),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id),
  title text not null,
  description text,
  category text not null default 'Otro',
  location text not null,
  starts_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'finished')),
  created_at timestamptz not null default now()
);

create table if not exists public.event_staff (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  attendee_id uuid not null references public.profiles(id),
  attendee_name text not null,
  attendee_email text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  registered_at timestamptz not null default now(),
  unique (event_id, attendee_id)
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null unique references public.registrations(id) on delete cascade,
  token_hash text not null unique,
  signature text not null,
  status text not null default 'valid' check (status in ('valid', 'used', 'cancelled', 'revoked')),
  issued_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.tickets(id),
  event_id uuid not null references public.events(id),
  attendee_name text not null,
  scanner_id uuid not null references public.profiles(id),
  checked_in_at timestamptz not null default now(),
  device_id text
);

create index if not exists idx_events_starts_at on public.events(starts_at);
create index if not exists idx_registrations_event on public.registrations(event_id);
create index if not exists idx_tickets_event on public.tickets(event_id);
create index if not exists idx_attendance_event on public.attendance(event_id);

-- Crea automáticamente el perfil básico cuando se registra un usuario en Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'attendee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_eventpass on auth.users;
create trigger on_auth_user_created_eventpass
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Función auxiliar SECURITY DEFINER para evitar políticas RLS recursivas.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_event_staff(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.event_staff es
      where es.event_id = target_event_id and es.user_id = auth.uid()
    )
    or public.current_user_role() = 'admin';
$$;

create or replace function public.is_event_owner(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = target_event_id and e.organizer_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_staff enable row level security;
alter table public.registrations enable row level security;
alter table public.tickets enable row level security;
alter table public.attendance enable row level security;

-- Perfiles: cada usuario consulta su perfil. La asignación de roles se realiza por un administrador.
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
for select to authenticated
using (id = auth.uid() or public.current_user_role() = 'admin');

-- Eventos publicados visibles para usuarios autenticados; organizadores gestionan sus eventos.
drop policy if exists "events_read_published_or_owner" on public.events;
create policy "events_read_published_or_owner" on public.events
for select to authenticated
using (status = 'published' or organizer_id = auth.uid() or public.is_event_staff(id));

drop policy if exists "events_insert_organizer_or_admin" on public.events;
create policy "events_insert_organizer_or_admin" on public.events
for insert to authenticated
with check (
  organizer_id = auth.uid()
  and public.current_user_role() in ('organizer', 'admin')
);

drop policy if exists "events_update_owner_or_admin" on public.events;
create policy "events_update_owner_or_admin" on public.events
for update to authenticated
using (organizer_id = auth.uid() or public.current_user_role() = 'admin')
with check (organizer_id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "events_delete_owner_or_admin" on public.events;
create policy "events_delete_owner_or_admin" on public.events
for delete to authenticated
using (organizer_id = auth.uid() or public.current_user_role() = 'admin');

-- Personal asignado al evento.
drop policy if exists "event_staff_read_related" on public.event_staff;
create policy "event_staff_read_related" on public.event_staff
for select to authenticated
using (user_id = auth.uid() or public.is_event_owner(event_id) or public.is_event_staff(event_id));

drop policy if exists "event_staff_manage_owner_admin" on public.event_staff;
create policy "event_staff_manage_owner_admin" on public.event_staff
for all to authenticated
using (public.is_event_owner(event_id) or public.current_user_role() = 'admin')
with check (public.is_event_owner(event_id) or public.current_user_role() = 'admin');

-- Inscripciones: los participantes consultan las suyas; el equipo del evento puede consultarlas.
drop policy if exists "registrations_read_related" on public.registrations;
create policy "registrations_read_related" on public.registrations
for select to authenticated
using (attendee_id = auth.uid() or public.is_event_owner(event_id) or public.is_event_staff(event_id));

drop policy if exists "registrations_create_self_for_published_event" on public.registrations;
create policy "registrations_create_self_for_published_event" on public.registrations
for insert to authenticated
with check (
  attendee_id = auth.uid()
  and exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
);

drop policy if exists "registrations_cancel_self_or_owner" on public.registrations;
create policy "registrations_cancel_self_or_owner" on public.registrations
for update to authenticated
using (attendee_id = auth.uid() or public.is_event_owner(event_id) or public.is_event_staff(event_id))
with check (attendee_id = auth.uid() or public.is_event_owner(event_id) or public.is_event_staff(event_id));

-- Los boletos se emiten desde una función segura del servidor; el cliente solo puede leer los propios o los de su evento.
drop policy if exists "tickets_read_related" on public.tickets;
create policy "tickets_read_related" on public.tickets
for select to authenticated
using (
  exists (select 1 from public.registrations r where r.id = registration_id and r.attendee_id = auth.uid())
  or public.is_event_owner(event_id)
  or public.is_event_staff(event_id)
);

-- La asistencia solo puede registrarse por personal asignado o administradores.
drop policy if exists "attendance_read_event_team" on public.attendance;
create policy "attendance_read_event_team" on public.attendance
for select to authenticated
using (public.is_event_owner(event_id) or public.is_event_staff(event_id));

drop policy if exists "attendance_insert_authorized_scanner" on public.attendance;
create policy "attendance_insert_authorized_scanner" on public.attendance
for insert to authenticated
with check (
  scanner_id = auth.uid()
  and public.is_event_staff(event_id)
  and exists (
    select 1 from public.tickets t
    where t.id = ticket_id and t.event_id = event_id and t.status = 'valid'
  )
);

-- Para asignar el rol de organizador a un usuario desde SQL Editor (sustituye el UUID):
-- update public.profiles set role = 'organizer' where id = 'UUID-DEL-USUARIO';
-- Para asignar un administrador:
-- update public.profiles set role = 'admin' where id = 'UUID-DEL-USUARIO';
