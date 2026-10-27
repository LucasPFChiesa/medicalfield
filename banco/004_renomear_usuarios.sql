-- Reorganização das APIs: renomeia os usuários de banco antigos para o nome
-- da API que passou a usá-los. Não apaga dados e mantém as senhas
-- (o PostgreSQL guarda as senhas com SCRAM-SHA-256, que não depende do nome).
--   mf_atendimentos (Python) -> mf_api1
--   mf_sync         (Go)     -> mf_api2
--   mf_cadastros    (Node)   -> mf_api3
-- Depois de rodar este arquivo, reaplique as permissões: banco/criar_banco.sh --permissoes
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_atendimentos') THEN
        ALTER ROLE mf_atendimentos RENAME TO mf_api1;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_sync') THEN
        ALTER ROLE mf_sync RENAME TO mf_api2;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_cadastros') THEN
        ALTER ROLE mf_cadastros RENAME TO mf_api3;
    END IF;
END $$;
