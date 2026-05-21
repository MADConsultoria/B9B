# Calendario de Mentorados

Aplicacao estatica com uma API Node pequena para publicar eventos com token e salvar no Supabase.

## Rodar local

```bash
node server.js
```

Acesse:

```text
http://localhost:8080
```

Sem variaveis do Supabase, o servidor usa dados locais de demonstracao e aceita os tokens:

```text
MENTORADO-2026
B9B-CLIENTE
```

## Configurar Supabase

1. Rode o SQL de `supabase/schema.sql` no SQL Editor do Supabase.
2. Defina um `TOKEN_PEPPER` forte.
3. Gere o hash do token de cada cliente:

```bash
TOKEN_PEPPER=sua-frase-secreta node scripts/hash-token.js TOKEN_DO_CLIENTE
```

No PowerShell:

```powershell
$env:TOKEN_PEPPER="sua-frase-secreta"; node scripts/hash-token.js TOKEN_DO_CLIENTE
```

4. Insira o cliente no Supabase:

```sql
insert into public.event_clients (name, token_hash)
values ('Nome do Cliente', 'HASH_GERADO_AQUI');
```

Se as tabelas ja existirem e voce estiver adicionando imagens depois, rode:

```sql
alter table public.events
  add column if not exists image_url_1 text,
  add column if not exists image_url_2 text;
```

Para adicionar categorias online/presencial:

```sql
alter table public.events
  add column if not exists categories text[] not null default '{}';
```

## Variaveis de ambiente no Dockploy

```text
PORT=8080
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
TOKEN_PEPPER=mesma-frase-usada-para-gerar-os-hashes
```
