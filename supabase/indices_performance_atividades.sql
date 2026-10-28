-- Sugestões de índices para os fluxos de Atividades e Planner.
-- Execute manualmente no Supabase após revisar o plano de execução e o espaço disponível.
create index if not exists atividades_colaboradores_agenda_idx
  on public.atividades_colaboradores (colaborador, data_inicio, data_termino);
create index if not exists atividade_classificacoes_atividade_idx
  on public.atividade_classificacoes (atividade_id);
create index if not exists atividade_planner_itens_atividade_idx
  on public.atividade_planner_itens (atividade_id);
create index if not exists atividade_planner_itens_item_idx
  on public.atividade_planner_itens (item_id);
create index if not exists atividade_planner_itens_checklist_idx
  on public.atividade_planner_itens (checklist_id);
create index if not exists planner_checklist_itens_checklist_idx
  on public.planner_checklist_itens (checklist_id);
create index if not exists planner_checklists_chave_sincronizacao_idx
  on public.planner_checklists (chave_sincronizacao);
create index if not exists obras_nome_normalizado_idx
  on public.obras (nome_normalizado);