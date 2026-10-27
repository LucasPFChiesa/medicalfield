-- Um usuário de banco por API. As permissões garantem que cada API só grava
-- nas tabelas de que é dona:
--   API 1 (Python) - autenticação, logs e documentos: profissional, log_acesso
--   API 2 (Go)     - prontuários e sincronização:     prontuario, sync_operacao
--   API 3 (Node)   - pessoas, medicamentos e atendimentos:
--                    paciente, medicamento, atendimento, medicamento_administrado
-- As senhas e o nome do banco chegam como variáveis do psql (ver criar_banco.sh).
-- Os usuários são do servidor PostgreSQL inteiro, por isso só são criados uma vez
-- (o banco de testes reaproveita os mesmos usuários).
-- Pode ser executado de novo: primeiro tira tudo, depois concede o necessário.

SELECT format('CREATE ROLE mf_api1 LOGIN PASSWORD %L', :'senha_api1')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_api1') \gexec
SELECT format('CREATE ROLE mf_api2 LOGIN PASSWORD %L', :'senha_api2')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_api2') \gexec
SELECT format('CREATE ROLE mf_api3 LOGIN PASSWORD %L', :'senha_api3')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_api3') \gexec

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mf_api1, mf_api2, mf_api3;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mf_api1, mf_api2, mf_api3;

GRANT CONNECT ON DATABASE :"nome_banco" TO mf_api1, mf_api2, mf_api3;
GRANT USAGE ON SCHEMA public TO mf_api1, mf_api2, mf_api3;
-- O trigger controlar_versao usa a sequência em toda gravação.
GRANT USAGE ON SEQUENCE seq_alteracao_global TO mf_api1, mf_api2, mf_api3;

-- Todas registram os próprios acessos.
GRANT INSERT ON log_acesso TO mf_api1, mf_api2, mf_api3;
GRANT USAGE ON SEQUENCE log_acesso_id_seq TO mf_api1, mf_api2, mf_api3;

-- Sem DELETE nas tabelas clínicas: a exclusão é lógica (excluido_em).

-- API 1 (Python): dona de profissional (login) e da consulta da auditoria.
-- Lê os dados clínicos para montar a ficha em PDF.
GRANT SELECT, INSERT, UPDATE ON profissional TO mf_api1;
GRANT SELECT ON log_acesso TO mf_api1;
GRANT SELECT ON paciente, prontuario, medicamento, atendimento, medicamento_administrado TO mf_api1;

-- API 2 (Go): dona de prontuário e do registro de sincronização; lê o restante para o pull.
GRANT SELECT, INSERT, UPDATE ON prontuario, sync_operacao TO mf_api2;
GRANT SELECT ON paciente, medicamento, atendimento, medicamento_administrado TO mf_api2;
GRANT SELECT (id, nome, tipo_registro, numero_registro, perfil, ativo, seq_alteracao) ON profissional TO mf_api2;

-- API 3 (Node): dona de pessoa, medicamento e atendimento.
GRANT SELECT, INSERT, UPDATE ON paciente, medicamento, atendimento TO mf_api3;
GRANT SELECT, INSERT, UPDATE, DELETE ON medicamento_administrado TO mf_api3;
GRANT SELECT ON prontuario TO mf_api3;
GRANT SELECT (id, nome, tipo_registro, numero_registro, perfil) ON profissional TO mf_api3;
