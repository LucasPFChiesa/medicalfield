-- MedicalField - estrutura do banco central

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Sequência global usada pelo pull da sincronização: toda inserção ou
-- alteração recebe um número maior que o anterior, em qualquer tabela.
CREATE SEQUENCE seq_alteracao_global;

-- Mantém versao, seq_alteracao e datas mesmo quando o registro é
-- inserido manualmente pelo psql (passo 9 do roteiro).
CREATE FUNCTION controlar_versao() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.versao := 1;
        NEW.criado_em := COALESCE(NEW.criado_em, now());
    ELSE
        NEW.versao := OLD.versao + 1;
        NEW.criado_em := OLD.criado_em;
    END IF;
    NEW.atualizado_em := now();
    NEW.seq_alteracao := nextval('seq_alteracao_global');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TABLE profissional (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            TEXT NOT NULL,
    tipo_registro   TEXT NOT NULL CHECK (tipo_registro IN ('CRM', 'COREN', 'SOCORRISTA')),
    numero_registro TEXT NOT NULL,
    senha_hash      TEXT NOT NULL,
    perfil          TEXT NOT NULL CHECK (perfil IN ('admin', 'medico', 'enfermeiro', 'socorrista')),
    email           TEXT,
    ativo           BOOLEAN NOT NULL DEFAULT true,
    versao          INT NOT NULL DEFAULT 1,
    seq_alteracao   BIGINT NOT NULL DEFAULT 0,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tipo_registro, numero_registro)
);

CREATE TABLE paciente (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                        TEXT NOT NULL,
    cpf                         VARCHAR(11) CHECK (cpf ~ '^[0-9]{11}$'),
    data_nascimento             DATE,
    sexo                        CHAR(1) CHECK (sexo IN ('M', 'F', 'O')),
    telefone                    TEXT,
    email                       TEXT,
    contato_emergencia_nome     TEXT,
    contato_emergencia_telefone TEXT,
    criado_por                  UUID REFERENCES profissional(id),
    versao                      INT NOT NULL DEFAULT 1,
    seq_alteracao               BIGINT NOT NULL DEFAULT 0,
    criado_em                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    alterado_no_cliente_em      TIMESTAMPTZ,
    excluido_em                 TIMESTAMPTZ
);
CREATE UNIQUE INDEX paciente_cpf_unico ON paciente (cpf) WHERE cpf IS NOT NULL AND excluido_em IS NULL;

CREATE TABLE prontuario (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id            UUID NOT NULL REFERENCES paciente(id),
    tipo_sanguineo         TEXT CHECK (tipo_sanguineo IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    alergias               TEXT,
    comorbidades           TEXT,
    uso_continuo           TEXT,
    observacoes            TEXT,
    criado_por             UUID REFERENCES profissional(id),
    versao                 INT NOT NULL DEFAULT 1,
    seq_alteracao          BIGINT NOT NULL DEFAULT 0,
    criado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    alterado_no_cliente_em TIMESTAMPTZ,
    excluido_em            TIMESTAMPTZ
);
-- Cada paciente tem um único prontuário ativo.
CREATE UNIQUE INDEX prontuario_paciente_unico ON prontuario (paciente_id) WHERE excluido_em IS NULL;

CREATE TABLE medicamento (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            TEXT NOT NULL,
    principio_ativo TEXT,
    apresentacao    TEXT,
    concentracao    TEXT,
    via_padrao      TEXT,
    alerta          TEXT,
    versao          INT NOT NULL DEFAULT 1,
    seq_alteracao   BIGINT NOT NULL DEFAULT 0,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    excluido_em     TIMESTAMPTZ
);

CREATE TABLE atendimento (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id            UUID NOT NULL REFERENCES paciente(id),
    prontuario_id          UUID REFERENCES prontuario(id),
    profissional_id        UUID NOT NULL REFERENCES profissional(id),
    data_hora              TIMESTAMPTZ NOT NULL,
    tipo_ocorrencia        TEXT NOT NULL CHECK (tipo_ocorrencia IN
                               ('clinica', 'trauma', 'acidente_transito', 'queda',
                                'obstetrica', 'psiquiatrica', 'outra')),
    local                  TEXT,
    descricao              TEXT NOT NULL,
    -- sinais vitais (os limites só barram erros de digitação)
    pa_sistolica           INT CHECK (pa_sistolica BETWEEN 0 AND 300),
    pa_diastolica          INT CHECK (pa_diastolica BETWEEN 0 AND 250),
    fc                     INT CHECK (fc BETWEEN 0 AND 300),
    fr                     INT CHECK (fr BETWEEN 0 AND 100),
    spo2                   INT CHECK (spo2 BETWEEN 0 AND 100),
    temperatura            NUMERIC(4,1) CHECK (temperatura BETWEEN 25 AND 45),
    glicemia               INT CHECK (glicemia BETWEEN 0 AND 1000),
    -- Escala de Glasgow
    glasgow_ocular         INT CHECK (glasgow_ocular BETWEEN 1 AND 4),
    glasgow_verbal         INT CHECK (glasgow_verbal BETWEEN 1 AND 5),
    glasgow_motora         INT CHECK (glasgow_motora BETWEEN 1 AND 6),
    glasgow_total          INT GENERATED ALWAYS AS (glasgow_ocular + glasgow_verbal + glasgow_motora) STORED,
    -- triagem
    manchester             TEXT CHECK (manchester IN ('vermelho', 'laranja', 'amarelo', 'verde', 'azul')),
    start                  TEXT CHECK (start IN ('vermelho', 'amarelo', 'verde', 'preto')),
    versao                 INT NOT NULL DEFAULT 1,
    seq_alteracao          BIGINT NOT NULL DEFAULT 0,
    criado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    alterado_no_cliente_em TIMESTAMPTZ,
    excluido_em            TIMESTAMPTZ
);
CREATE INDEX atendimento_paciente ON atendimento (paciente_id);

-- Sempre gravado junto com o atendimento, por isso não tem versão própria:
-- qualquer mudança aqui também atualiza o atendimento.
CREATE TABLE medicamento_administrado (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atendimento_id UUID NOT NULL REFERENCES atendimento(id) ON DELETE CASCADE,
    medicamento_id UUID NOT NULL REFERENCES medicamento(id),
    dose           NUMERIC(10,2) NOT NULL CHECK (dose > 0),
    unidade        TEXT NOT NULL,
    via            TEXT,
    horario        TIMESTAMPTZ NOT NULL,
    observacao     TEXT
);
CREATE INDEX medicamento_administrado_atendimento ON medicamento_administrado (atendimento_id);

CREATE TRIGGER versao_profissional BEFORE INSERT OR UPDATE ON profissional FOR EACH ROW EXECUTE FUNCTION controlar_versao();
CREATE TRIGGER versao_paciente     BEFORE INSERT OR UPDATE ON paciente     FOR EACH ROW EXECUTE FUNCTION controlar_versao();
CREATE TRIGGER versao_prontuario   BEFORE INSERT OR UPDATE ON prontuario   FOR EACH ROW EXECUTE FUNCTION controlar_versao();
CREATE TRIGGER versao_medicamento  BEFORE INSERT OR UPDATE ON medicamento  FOR EACH ROW EXECUTE FUNCTION controlar_versao();
CREATE TRIGGER versao_atendimento  BEFORE INSERT OR UPDATE ON atendimento  FOR EACH ROW EXECUTE FUNCTION controlar_versao();


-- Registro de cada operação recebida no push. O op_id vem do cliente e
-- garante a idempotência: a mesma operação nunca é aplicada duas vezes.
CREATE TABLE sync_operacao (
    op_id            UUID PRIMARY KEY,
    dispositivo_id   TEXT NOT NULL,
    profissional_id  UUID,
    entidade         TEXT NOT NULL CHECK (entidade IN ('paciente', 'prontuario', 'atendimento')),
    entidade_id      UUID NOT NULL,
    acao             TEXT NOT NULL CHECK (acao IN ('criar', 'atualizar', 'excluir')),
    versao_base      INT NOT NULL DEFAULT 0,
    status           TEXT NOT NULL CHECK (status IN ('aplicada', 'conflito', 'erro')),
    payload_cliente  JSONB,
    payload_servidor JSONB,
    mensagem         TEXT,
    recebido_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processado_em    TIMESTAMPTZ
);

-- Log de acesso de todos os serviços. Não tem chave estrangeira para
-- profissional, pois o log precisa existir mesmo para tentativas inválidas.
CREATE TABLE log_acesso (
    id              BIGSERIAL PRIMARY KEY,
    data_hora       TIMESTAMPTZ NOT NULL DEFAULT now(),
    servico         TEXT NOT NULL,
    origem          TEXT NOT NULL DEFAULT 'servidor' CHECK (origem IN ('servidor', 'cliente')),
    ip              TEXT,
    profissional_id UUID,
    metodo          TEXT NOT NULL,
    rota            TEXT NOT NULL,
    status          INT,
    duracao_ms      NUMERIC(10,2)
);
CREATE INDEX log_acesso_data ON log_acesso (data_hora);
