-- Executar manualmente no SQL Editor do Supabase antes de publicar o recurso.
create table if not exists public.obra_entregas (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras(id) on delete restrict,
  tipo_emissao text not null check (tipo_emissao in ('entrega_inicial', 'revisao')),
  revisao text not null,
  data_entrega date not null,
  link_processo text not null check (link_processo ~* '^https?://'),
  observacoes text,
  periodo_inicio date,
  periodo_fim date,
  resumo_json jsonb not null default '{}'::jsonb,
  criado_por uuid references public.usuarios_setor(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (obra_id, revisao)
);

create table if not exists public.obra_entrega_projetos (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.obra_entregas(id) on delete cascade,
  obra_id uuid not null references public.obras(id) on delete restrict,
  projeto text not null,
  projeto_chave text not null,
  codigo_projeto text,
  tipo_emissao text not null,
  revisao text not null,
  link_projeto text check (link_projeto is null or link_projeto ~* '^https?://'),
  observacoes text,
  horas numeric(12,2) not null default 0,
  atividades integer not null default 0,
  periodo_inicio date,
  periodo_fim date,
  responsaveis_json jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  unique (entrega_id, projeto_chave)
);

create index if not exists obra_entregas_obra_data_idx on public.obra_entregas (obra_id, data_entrega desc);
create index if not exists obra_entrega_projetos_entrega_idx on public.obra_entrega_projetos (entrega_id);
alter table public.obra_entregas enable row level security;
alter table public.obra_entrega_projetos enable row level security;

-- O backend usa a service role e aplica requireUser + perfil admin. Não são
-- criadas políticas de acesso direto pelo navegador para estes snapshots.