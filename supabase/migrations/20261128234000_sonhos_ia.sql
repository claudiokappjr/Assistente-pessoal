-- Sonhos: a IA lê o relato, sugere uma interpretação (como hipótese, sem diagnóstico)
-- e extrai os pontos principais (motivos, emoções, elementos) para contar ao longo do tempo.
-- A interpretação do próprio usuário/profissional fica separada (coluna interpretation).
alter table public.psy_entries
  add column symbols text[] not null default '{}',
  add column ai_status text check (ai_status in ('pendente', 'pronto', 'falhou')),
  add column ai_summary text,
  add column ai_interpretation text,
  add column ai_questions text[] not null default '{}',
  add column ai_at timestamptz;
create index psy_entries_symbols_idx on public.psy_entries using gin (symbols);

-- Chamada genérica a uma Edge Function interna (sem esperar a resposta).
create or replace function private.call_function(_fn text, _body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare url text; k text;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select value into url from private.app_config where key = 'functions_url';
  select value into k from private.app_config where key = 'estimate_key';
  if url is null or k is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using url || '/' || _fn, jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', k), _body;
end $$;
revoke execute on function private.call_function from public, anon, authenticated;

-- Relato novo ou alterado = interpretar de novo.
create or replace function private.dream_ai_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind <> 'sonho' then new.ai_status := null; return new; end if;
  if tg_op = 'INSERT' or new.content is distinct from old.content then
    new.ai_status := 'pendente';
  end if;
  return new;
end $$;
create trigger dream_ai_status before insert or update on public.psy_entries
  for each row execute function private.dream_ai_status();

create or replace function private.dream_request_ai()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ai_status = 'pendente' and (tg_op = 'INSERT' or old.ai_status is distinct from 'pendente' or new.content is distinct from old.content) then
    perform private.call_function('dream-interpret', jsonb_build_object('id', new.id));
  end if;
  return null;
end $$;
create trigger dream_request_ai after insert or update on public.psy_entries
  for each row execute function private.dream_request_ai();
revoke execute on function private.dream_ai_status, private.dream_request_ai from public, anon, authenticated;

-- Sonhos já registrados entram na fila.
update public.psy_entries set ai_status = 'pendente' where kind = 'sonho' and ai_status is null;
