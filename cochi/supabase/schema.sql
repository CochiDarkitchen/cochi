-- Cochi: esquema inicial para Supabase. Ejecutar en SQL Editor con un usuario administrador del proyecto.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key default gen_random_uuid()::text,
  slug text not null unique,
  name text not null,
  category text not null,
  description text not null default '',
  price_usd numeric(10,2) not null check (price_usd >= 0),
  image text not null default '',
  available boolean not null default true,
  availability_days integer[] not null default '{}'::integer[] check (availability_days <@ array[0,1,2,3,4,5,6]::integer[]),
  is_visible boolean not null default true,
  is_coming_soon boolean not null default false,
  featured boolean not null default false,
  brand text not null default 'cochi' check (brand in ('cochi','dulce')),
  sort_order integer not null default 999,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.is_cochi_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_cochi_admin() from public;
grant execute on function public.is_cochi_admin() to anon, authenticated;

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;
grant select on public.admin_users to authenticated;

alter table public.products enable row level security;
alter table public.admin_users enable row level security;
alter table public.site_settings enable row level security;

drop policy if exists "Public may read visible catalog; admins may read all" on public.products;
create policy "Public may read visible catalog; admins may read all"
on public.products for select to anon, authenticated
using (is_visible = true or public.is_cochi_admin());

drop policy if exists "Admins may insert catalog items" on public.products;
create policy "Admins may insert catalog items"
on public.products for insert to authenticated
with check (public.is_cochi_admin());

drop policy if exists "Admins may update catalog items" on public.products;
create policy "Admins may update catalog items"
on public.products for update to authenticated
using (public.is_cochi_admin()) with check (public.is_cochi_admin());

drop policy if exists "Admins may delete catalog items" on public.products;
create policy "Admins may delete catalog items"
on public.products for delete to authenticated
using (public.is_cochi_admin());

drop policy if exists "Admins may read their own authorization row" on public.admin_users;
create policy "Admins may read their own authorization row"
on public.admin_users for select to authenticated
using (user_id = auth.uid());

-- Solo estas claves no secretas son legibles por la web pública.
drop policy if exists "Public settings are readable" on public.site_settings;
create policy "Public settings are readable"
on public.site_settings for select to anon, authenticated
using (key in ('whatsapp_number','whatsapp_number_confirmed','delivery_fee_usd','order_modes','order_modes_confirmed'));

drop policy if exists "Admins may insert public settings" on public.site_settings;
create policy "Admins may insert public settings"
on public.site_settings for insert to authenticated
with check (public.is_cochi_admin());

drop policy if exists "Admins may update public settings" on public.site_settings;
create policy "Admins may update public settings"
on public.site_settings for update to authenticated
using (public.is_cochi_admin()) with check (public.is_cochi_admin());

drop policy if exists "Admins may delete public settings" on public.site_settings;
create policy "Admins may delete public settings"
on public.site_settings for delete to authenticated
using (public.is_cochi_admin());

-- Valores deliberadamente pendientes: el negocio debe confirmar el contacto y las modalidades.
insert into public.site_settings(key, value) values
  ('whatsapp_number', to_jsonb(''::text)),
  ('whatsapp_number_confirmed', 'false'::jsonb),
  ('delivery_fee_usd', 'null'::jsonb),
  ('order_modes', '[]'::jsonb),
  ('order_modes_confirmed', 'false'::jsonb)
on conflict (key) do nothing;

-- Bucket público para que los visitantes puedan ver las fotografías. La escritura queda restringida a admins.
insert into storage.buckets (id, name, public)
values ('cochi-products', 'cochi-products', true)
on conflict (id) do update set public = true;

drop policy if exists "Cochi admins may upload product photos" on storage.objects;
create policy "Cochi admins may upload product photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'cochi-products' and public.is_cochi_admin());

drop policy if exists "Cochi admins may update product photos" on storage.objects;
create policy "Cochi admins may update product photos"
on storage.objects for update to authenticated
using (bucket_id = 'cochi-products' and public.is_cochi_admin())
with check (bucket_id = 'cochi-products' and public.is_cochi_admin());

drop policy if exists "Cochi admins may delete product photos" on storage.objects;
create policy "Cochi admins may delete product photos"
on storage.objects for delete to authenticated
using (bucket_id = 'cochi-products' and public.is_cochi_admin());
