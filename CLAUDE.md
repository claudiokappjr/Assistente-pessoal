# Instruções do projeto

- Usuário é leigo em programação: explicar passos em português, simples e curtos.
- Supabase: projeto `lehjyixgezjrhkuzusci` (sa-east-1). Toda mudança de banco = nova migration em `supabase/migrations/` + teste em `supabase/tests/01_rls_test.sql` + aplicar via MCP.
- Rodar `supabase/tests/run_local.sh` e `npm run build` (apps/web) antes de cada commit.
- Nunca colocar chaves secretas no frontend. Nunca exibir dados simulados como reais; módulo não pronto = "Em construção".
- Admin não acessa conteúdo clínico: tabelas sensíveis não têm política para admin.
- Novas tabelas de módulos pessoais: coluna `owner_id`, RLS por dono + `private.has_consent(owner_id, '<modulo>')` para profissionais.
