# Assistente Pessoal

Plataforma SaaS de assistente pessoal com IA: finanças, saúde, psicanálise, nutrição, exercícios, ciclo menstrual, agenda e memórias, com WhatsApp como canal principal e profissionais atendendo clientes com consentimento granular (LGPD).

Plano completo de arquitetura: ver documento "Assistente Pessoal — Arquitetura e Plano de Desenvolvimento".

## Estrutura

```
apps/web/              App web (React + TypeScript + Vite + Tailwind 4), responsivo e PWA
supabase/migrations/   Estrutura do banco, versionada (aplicar em ordem)
supabase/tests/        Testes de isolamento de dados (RLS) em Postgres local
```

## Supabase

- Projeto: `assistente-pessoal` (`lehjyixgezjrhkuzusci`), região São Paulo (`sa-east-1`), organização Terra Capital.
- Tudo é protegido por Row Level Security. Funções auxiliares ficam no schema `private` (não exposto na API).
- Chaves secretas (service_role, IA, WhatsApp, pagamentos) **nunca** vão para o frontend; ficarão em Edge Functions.

## Rodar o app localmente

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

## Testar as permissões do banco

Requer Postgres 15+ local.

```bash
PGHOST=localhost PGUSER=postgres ./supabase/tests/run_local.sh
```

Os 169 testes cobrem: usuário só vê os próprios dados; profissional precisa de aprovação do admin; profissional só acessa módulo com consentimento ativo do cliente; revogação e encerramento de vínculo cortam o acesso na hora; administrador não se auto-remove; auditoria é imutável; exames, remédios e consultas seguem as mesmas regras (e o arquivo enviado fica numa pasta privada do dono).

## Status por fase

| Fase | Escopo | Status |
| --- | --- | --- |
| 1 | Autenticação, perfis, papéis, organizações, módulos, planos, consentimentos, auditoria, painéis | Concluída |
| 2 | Assistente central, caixa de entrada, WhatsApp | Em andamento (app pronto; WhatsApp pendente) |
| 3 | Agendas, finanças, assinaturas | Em andamento (módulos v1 prontos; assinaturas pendentes) |
| 4 | Saúde, psicanálise, revisão profissional | Não iniciada |
| 5 | Nutrição, exercícios, ciclo | Não iniciada |
| 6 | Memórias, correlações, automações | Não iniciada |

Telas dos módulos das fases 2–6 aparecem como "Em construção" e não exibem dados simulados.
