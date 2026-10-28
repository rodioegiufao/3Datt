create extension if not exists "pgcrypto";

create table if not exists public.atividades_semanais (
  id uuid primary key default gen_random_uuid(),
  semana text not null,
  atividade text not null,
  descricao text,
  prioridade text,
  entregas text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.atividades_semanais
add column if not exists prioridade text;

alter table public.atividades_semanais
add column if not exists entregas text;

create index if not exists idx_atividades_semanais_semana
on public.atividades_semanais (semana);

create or replace function public.set_atividades_semanais_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_atividades_semanais_atualizado_em
on public.atividades_semanais;

create trigger trg_atividades_semanais_atualizado_em
before update on public.atividades_semanais
for each row execute function public.set_atividades_semanais_atualizado_em();
alter table public.atividades_semanais enable row level security;
