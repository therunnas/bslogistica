# Backup lógico de Production — criação, verificação, restauração e segunda cópia

SDLC: Manutenção / Recuperação. Procedimento versionado, **não** autorização de execução. Nenhum
passo grava em Production: o backup usa `supabase db dump`, que lê com snapshot consistente.
Nunca versionar os arquivos nem a senha; nunca colar a senha em chat, ticket ou e-mail.

## 1. Estado do backup de 05/11/2026 (migration 034)

- Local: `~/bs-backups-producao/2026-11-05-034/` (máquina de quem executou), permissão 700.
- Arquivos cifrados (AES-256-CBC, PBKDF2 com 200.000 iterações): `schema-public`, `data-public`,
  `data-auth`, `data-migrations`, `schema-roles` (`.sql.enc`), mais `SHA256-enc.txt` (hash dos
  cifrados), `SHA256-plain.txt` (hash do texto em claro, para conferir depois de decifrar) e
  `LEIA-ME.txt`. O texto em claro foi apagado.
- Senha: Chaveiro do macOS, item `bs-backup-producao-2026-11-05-034`.
- Verificado de novo na sessão 16: os cinco arquivos decifram e conferem com o hash (5/5) e foram
  restaurados em um Supabase local isolado (seção 3).
- **Production não tem dados de negócio** (0 clientes, 0 lançamentos); o conteúdo relevante é
  esquema, 3 contas de acesso, 10 perfis, 9 papéis, 1 fator MFA e a auditoria.

## 2. Como criar um backup novo (somente leitura)

1. Conferir o projeto: `ehkduqokntemtmqzdrbd` (Production). Usar
   `env -u SUPABASE_ACCESS_TOKEN` e `--project-ref` explícito (o `.env` define `SUPABASE_PROJECT_ID`).
2. Registrar a linha de base (somente leitura): head de migrations, contagens por tabela,
   somas financeiras, flags do motor e impressão digital do catálogo (ver seção 3.3).
3. Criar os dumps numa pasta 700 fora do Git:
   `supabase db dump --linked --project-ref <ref> -s public -f schema-public.sql`;
   `... --data-only -s public -f data-public.sql`; `... --data-only -s auth -f data-auth.sql`;
   `... --data-only -s supabase_migrations -f data-migrations.sql`; `... --role-only -f schema-roles.sql`.
   (Cada flag como argumento separado; `--data-only -s x` entre aspas vira um único argumento inválido.)
4. `shasum -a 256` de cada arquivo em claro, guardado em `SHA256-plain.txt`.
5. Cifrar cada arquivo: `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in X.sql -out X.sql.enc
-pass env:PASS`, com `PASS` gerada por `openssl rand -base64 33`, **exportada** só na sessão do
   terminal e guardada no Chaveiro (`security add-generic-password ... -w "$PASS"`).
6. Decifrar de volta e comparar o hash antes de apagar o texto em claro. Só então apagar.
7. `shasum -a 256 *.enc > SHA256-enc.txt`.

## 3. Restauração (ensaio) em ambiente isolado

1. Stack local com `project_id` e portas próprios (nunca as do repositório) e **sem** migrations no
   diretório de trabalho (senão o `supabase start` as aplica e o banco sobe na 045).
2. Decifrar para uma pasta 700 temporária e conferir `SHA256-plain.txt`.
3. Restaurar **como `supabase_admin`**, nesta ordem, com os ajustes abaixo (todos aprendidos no ensaio):
   - antes de tudo: `CREATE EXTENSION btree_gist, pgcrypto, "uuid-ossp"` no esquema `extensions` (o esquema
     tem restrições de exclusão `gist` sobre `uuid`);
   - criar `supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`
     com **dono `postgres`** (senão o `db push` falha com permissão negada) antes dos dados;
   - `auth.one_time_tokens`: a versão local do GoTrue pode não ter a coluna `expires_at` que Production
     tem. Com `ALTER TABLE auth.one_time_tokens ADD COLUMN expires_at timestamptz` antes do `data-auth`,
     **os 3 tokens pendentes de Production são restaurados** (sem isso a única falha do ensaio era essa
     tabela, e tokens de recuperação/confirmação vivos seriam perdidos). Em recuperação real use um
     destino com a **mesma versão do GoTrue** de Production;
   - ordem: `schema-roles` → `schema-public` → `supabase_migrations` (dados) → `data-public` → `data-auth`.
4. **Reconciliar privilégios**: o dump traz os `GRANT`, mas não os `REVOKE` que Production fez sobre os
   privilégios padrão do Supabase. Num destino com privilégios padrão (local ou projeto novo) `anon`,
   `authenticated` e `service_role` ficam com `ALL` em tabelas e sequências. Depois da restauração:
   `REVOKE ALL ON ALL TABLES|SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;`
   `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;` (**não** de
   `PUBLIC`: o padrão de função é `PUBLIC` e o dump não o reemite) e reaplicar os `GRANT`/`REVOKE` do
   `schema-public`. Sem isso o banco restaurado fica **mais aberto** que Production (a RLS continua
   ligada nas 21 tabelas, mas a defesa em profundidade se perde).
5. Conferir contra Production (somente leitura): head, contagens, somas, flags, 21 tabelas/120 funções/65
   gatilhos/70 políticas/59 índices/123 restrições, e os hashes `fn_md5`, `policy_md5`, `trigger_md5`,
   `grants_md5`, `colgrants_md5`, `fn_owners_md5`, `cols_md5`. No ensaio de 05/11 todos coincidiram;
   diferença residual: 5 `EXECUTE` extras concedidos a `postgres` pelo dono `bslog_rpc_operacional`
   nas RPCs operacionais e `EXECUTE` de `PUBLIC` em `proteger_ultimo_admin()` (efeito da reconciliação;
   inofensivo, mas registrar).
6. Verificar o Auth restaurado de forma funcional (sem usar credenciais reais): criar uma conta de teste
   pela Admin API, login com senha (e senha errada recusada), enroll e verificação de TOTP (AAL1 → AAL2,
   código inválido recusado), `generateLink` de recuperação aceito uma vez e reuso recusado, e troca de
   senha de conta **com MFA** exigindo AAL2. Resultado de 05/11: todos passaram. Integridade: 0 identidades,
   fatores MFA e sessões sem conta; 7 perfis e 7 papéis **sem conta em `auth.users`** existem **também em
   Production** (herança de contas de teste removidas; não são efeito do backup).

## 4. Segunda cópia criptografada em destino independente (a decidir; nada foi transferido)

O backup hoje existe **só nesta máquina**. Perder o notebook perde o backup e a senha. Instruções:

1. **O que copiar:** somente os `.sql.enc`, `SHA256-enc.txt`, `SHA256-plain.txt` e `LEIA-ME.txt`.
   Os arquivos já estão cifrados; **não** enviar texto em claro, **nem** a senha junto.
2. **Onde:** um destino **independente** do notebook e da conta da Vercel/Supabase, escolhido e
   autorizado pela pessoa responsável pela BS. Exemplos válidos: disco externo cifrado guardado em outro
   local físico; bucket de armazenamento de objetos de **outra conta/provedor** com cifragem no servidor,
   versionamento e bloqueio de exclusão (retenção). Evitar pasta sincronizada pessoal.
3. **A senha, separada:** guardar a senha do Chaveiro num gerenciador de senhas da empresa **e** num
   segundo local (ex.: envelope lacrado com o responsável), nunca no mesmo destino dos arquivos.
4. **Como copiar (após autorização do destino):** copiar a pasta inteira (`rsync -a` ou `rclone copy`),
   depois conferir no destino com `shasum -a 256 -c SHA256-enc.txt`. Registrar data, destino e quem
   copiou no HANDOFF (sem a senha).
5. **Teste:** pelo menos uma vez, decifrar a segunda cópia numa máquina limpa com a senha do gerenciador
   e conferir `SHA256-plain.txt`.
6. **Validade:** o backup vale **enquanto Production não receber escrita**. Antes da janela de migração,
   refazer o dump se houver cadastro novo (conferir contagens por tabela e `auth.users`).
7. **Retenção:** manter este backup (034) até a implantação 035–045 ser aceita e haver backup pós-045.
