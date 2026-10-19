CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE profissional (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    numero_registro TEXT NOT NULL UNIQUE,
    perfil TEXT NOT NULL,
    email TEXT,
    senha_hash TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paciente (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    cpf VARCHAR(11) UNIQUE,
    data_nascimento DATE,
    telefone TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE atendimento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID NOT NULL REFERENCES paciente(id),
    profissional_id UUID NOT NULL REFERENCES profissional(id),
    data_hora TIMESTAMPTZ NOT NULL DEFAULT now(),
    descricao TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'aberto',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX atendimento_paciente_idx ON atendimento (paciente_id);
CREATE INDEX atendimento_profissional_idx ON atendimento (profissional_id);

