-- Um usuário de banco por microsserviço. As permissões garantem que cada
-- serviço só grava nas tabelas de que é dono.
-- As senhas e o nome do banco chegam como variáveis do psql (ver criar_banco.sh).
-- Os usuários são do servidor PostgreSQL inteiro, por isso só são criados uma vez
-- (o banco de testes reaproveita os mesmos usuários).

SELECT format('CREATE ROLE mf_cadastros LOGIN PASSWORD %L', :'senha_cadastros')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_cadastros') \gexec
SELECT format('CREATE ROLE mf_atendimentos LOGIN PASSWORD %L', :'senha_atendimentos')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_atendimentos') \gexec
SELECT format('CREATE ROLE mf_sync LOGIN PASSWORD %L', :'senha_sync')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_sync') \gexec

GRANT CONNECT ON DATABASE :"nome_banco" TO mf_cadastros, mf_atendimentos, mf_sync;
GRANT USAGE ON SCHEMA public TO mf_cadastros, mf_atendimentos, mf_sync;
GRANT USAGE ON SEQUENCE seq_alteracao_global TO mf_cadastros, mf_atendimentos;

-- Todos registram os próprios acessos.
GRANT INSERT ON log_acesso TO mf_cadastros, mf_atendimentos, mf_sync;
GRANT USAGE ON SEQUENCE log_acesso_id_seq TO mf_cadastros, mf_atendimentos, mf_sync;

-- Sem DELETE nas tabelas clínicas: a exclusão é lógica (excluido_em).

-- cadastros (Node): dono de profissional, paciente, prontuário e medicamento.
GRANT SELECT, INSERT, UPDATE ON profissional, paciente, prontuario, medicamento TO mf_cadastros;
GRANT SELECT ON log_acesso TO mf_cadastros;

-- atendimentos (Python): dono de atendimento e medicamento administrado.
GRANT SELECT, INSERT, UPDATE ON atendimento TO mf_atendimentos;
GRANT SELECT, INSERT, UPDATE, DELETE ON medicamento_administrado TO mf_atendimentos;
GRANT SELECT ON paciente, prontuario, medicamento TO mf_atendimentos;
GRANT SELECT (id, nome, tipo_registro, numero_registro, perfil) ON profissional TO mf_atendimentos;

-- sync (Go): dono do registro de sincronização; só lê o restante.
GRANT SELECT, INSERT, UPDATE ON sync_operacao TO mf_sync;
GRANT SELECT ON paciente, prontuario, medicamento, atendimento, medicamento_administrado TO mf_sync;
GRANT SELECT (id, nome, tipo_registro, numero_registro, perfil, ativo, seq_alteracao) ON profissional TO mf_sync;
