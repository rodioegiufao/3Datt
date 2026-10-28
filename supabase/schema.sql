create extension if not exists "pgcrypto";

create table if not exists public.usuarios_setor (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  usuario text not null unique,
  senha_hash text not null,
  perfil text not null default 'colaborador' check (perfil in ('admin', 'colaborador')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.usuarios_setor enable row level security;

create table if not exists public.atividades_colaboradores (
  id text primary key,
  colaborador text not null,
  obra text,
  prioridade text not null,
  projeto text not null,
  trabalhos text not null,
  fase text,
  item text,
  etapa text not null,
  data_inicio date,
  hora_inicio time,
  data_termino date,
  hora_termino time,
  data_prevista date,
  status text not null default 'Em progresso',
  observacoes text,
  criado_em timestamptz not null default now(),
  usuario_id uuid references public.usuarios_setor(id),
  criado_por_nome text
);

alter table public.atividades_colaboradores
  add column if not exists usuario_id uuid references public.usuarios_setor(id),
  add column if not exists criado_por_nome text,
  add column if not exists obra_id uuid,
  add column if not exists fase text,
  add column if not exists item text;

create index if not exists idx_atividades_usuario_id
on public.atividades_colaboradores (usuario_id);

create index if not exists idx_atividades_frente
on public.atividades_colaboradores (colaborador, obra_id, projeto, etapa);

create table if not exists public.planner_checklists (
  id uuid primary key default gen_random_uuid(),
  obra text not null,
  projeto text not null,
  tipo text not null,
  codigo_projeto text,
  titulo text,
  responsavel text,
  prioridade text check (prioridade in ('P0', 'P1', 'P2', 'P3')),
  data_prevista date,
  observacoes text,
  tarefas jsonb not null default '[]'::jsonb,
  criado_por uuid references public.usuarios_setor(id),
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.planner_checklists
  add column if not exists titulo text,
  add column if not exists tarefas jsonb not null default '[]'::jsonb,
  add column if not exists criado_por uuid references public.usuarios_setor(id),
  add column if not exists criado_por_nome text,
  add column if not exists atualizado_em timestamptz not null default now();

create index if not exists idx_planner_checklists_criado_em
on public.planner_checklists (criado_em desc);

alter table public.planner_checklists
  add column if not exists nome_tarefa text,
  add column if not exists status text default 'Não iniciado',
  add column if not exists data_inicio date,
  add column if not exists data_conclusao date,
  add column if not exists bucket text,
  add column if not exists anotacoes text;

update public.planner_checklists
set nome_tarefa = coalesce(nome_tarefa, titulo, codigo_projeto || ' - ' || tipo),
    data_conclusao = coalesce(data_conclusao, data_prevista),
    anotacoes = coalesce(anotacoes, observacoes)
where nome_tarefa is null or data_conclusao is null or anotacoes is null;

alter table public.planner_checklists
  alter column nome_tarefa set not null;

create table if not exists public.planner_checklist_itens (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.planner_checklists(id) on delete cascade,
  etapa text not null,
  atividade text not null,
  texto text not null,
  ordem integer default 0,
  concluido boolean default false,
  concluido_em timestamptz,
  concluido_por uuid references public.usuarios_setor(id),
  concluido_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_planner_checklist_itens_checklist_id
on public.planner_checklist_itens (checklist_id, ordem);

alter table public.planner_checklists enable row level security;
alter table public.planner_checklist_itens enable row level security;

alter table public.planner_checklists
  drop constraint if exists planner_checklists_prioridade_check;
