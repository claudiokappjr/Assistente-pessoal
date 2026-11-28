-- Resultados anteriores impressos no laudo (ex.: "Resultados anteriores: 12/03/2025 — 92").
-- Ficam no mesmo exame, marcados como anteriores e com a data em que foram medidos,
-- para entrar no gráfico de evolução.
alter table public.lab_results
  add column is_previous boolean not null default false,
  add column measured_on date;

alter table public.lab_results
  add constraint lab_results_previous_has_date check (not is_previous or measured_on is not null);

create index lab_results_marker_date_idx on public.lab_results(owner_id, marker_key, measured_on);
