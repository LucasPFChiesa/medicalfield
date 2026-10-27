-- Dados fictícios para testes e demonstração.
-- Todos os profissionais usam a senha passada em :senha_demo.

INSERT INTO profissional (nome, tipo_registro, numero_registro, senha_hash, perfil, email) VALUES
    ('Lucas Chiesa',     'CRM',        'admin',  crypt(:'senha_demo', gen_salt('bf', 10)), 'admin',      'lucas.chiesa@exemplo.com'),
    ('Médico Teste',     'CRM',        '20002-RS',  crypt(:'senha_demo', gen_salt('bf', 10)), 'medico',     'medico.teste@exemplo.com'),
    ('Enfermeiro Teste', 'COREN',      '300003-RS', crypt(:'senha_demo', gen_salt('bf', 10)), 'enfermeiro', 'enfermeiro.teste@exemplo.com'),
    ('Socorrista Teste', 'SOCORRISTA', 'SOC-0042',  crypt(:'senha_demo', gen_salt('bf', 10)), 'socorrista', 'socorrista.teste@exemplo.com');

INSERT INTO paciente (nome, cpf, data_nascimento, sexo, telefone, contato_emergencia_nome, contato_emergencia_telefone, criado_por) VALUES
    ('Ana Paula Ferreira',  '11122233344', '1985-03-12', 'F', '(51) 99811-2030', 'Carlos Ferreira',  '(51) 99811-2031', (SELECT id FROM profissional WHERE numero_registro = 'admin')),
    ('João Batista Lopes',  '22233344455', '1962-11-02', 'M', '(51) 99722-4410', 'Marta Lopes',      '(51) 99722-4411', (SELECT id FROM profissional WHERE numero_registro = 'admin')),
    ('Luiza Hartmann',      '33344455566', '2001-07-25', 'F', '(51) 98455-1020', 'Pedro Hartmann',   '(51) 98455-1021', (SELECT id FROM profissional WHERE numero_registro = 'admin')),
    ('Sérgio Mallmann',     '44455566677', '1978-01-30', 'M', '(51) 99130-7788', 'Rita Mallmann',    '(51) 99130-7789', (SELECT id FROM profissional WHERE numero_registro = 'admin')),
    ('Beatriz Weber Rocha', NULL,          '1994-09-18', 'F', NULL,              'Fernanda Weber',   '(51) 98003-5566', (SELECT id FROM profissional WHERE numero_registro = 'admin'));

INSERT INTO prontuario (paciente_id, tipo_sanguineo, alergias, comorbidades, uso_continuo, observacoes, criado_por)
SELECT p.id, d.tipo, d.alergias, d.comorbidades, d.uso, d.obs, p.criado_por
FROM (VALUES
    ('11122233344', 'O+',  'Dipirona',  'Asma',                   'Salbutamol inalatório', NULL),
    ('22233344455', 'A+',  NULL,        'Hipertensão, diabetes tipo 2', 'Losartana, metformina', 'Cardiopata'),
    ('33344455566', 'B-',  'Penicilina', NULL,                    NULL,                    NULL),
    ('44455566677', 'AB+', NULL,        'Epilepsia',              'Carbamazepina',         NULL)
) AS d(cpf, tipo, alergias, comorbidades, uso, obs)
JOIN paciente p ON p.cpf = d.cpf;

INSERT INTO prontuario (paciente_id, tipo_sanguineo, observacoes, criado_por)
SELECT id, NULL, 'Paciente sem documentos no primeiro atendimento', criado_por
FROM paciente WHERE nome = 'Beatriz Weber Rocha';

INSERT INTO medicamento (nome, principio_ativo, apresentacao, concentracao, via_padrao, alerta) VALUES
    ('Dipirona sódica',            'Dipirona',               'Ampola 2 mL',      '500 mg/mL',  'IV',          'Verificar alergia a dipirona'),
    ('Adrenalina',                 'Epinefrina',             'Ampola 1 mL',      '1 mg/mL',    'IV',          'Medicamento de alta vigilância'),
    ('AAS',                        'Ácido acetilsalicílico', 'Comprimido',       '100 mg',     'VO',          'Verificar alergia a AAS'),
    ('Morfina',                    'Sulfato de morfina',     'Ampola 1 mL',      '10 mg/mL',   'IV',          'Opioide: medicamento de alta vigilância'),
    ('Diazepam',                   'Diazepam',               'Ampola 2 mL',      '5 mg/mL',    'IV',          'Medicamento de alta vigilância'),
    ('Soro fisiológico 0,9%',      'Cloreto de sódio',       'Bolsa 500 mL',     '0,9%',       'IV',          NULL),
    ('Glicose 50%',                'Glicose',                'Ampola 10 mL',     '50%',        'IV',          NULL),
    ('Ondansetrona',               'Ondansetrona',           'Ampola 2 mL',      '2 mg/mL',    'IV',          NULL),
    ('Salbutamol',                 'Salbutamol',             'Aerossol',         '100 mcg/dose', 'Inalatória', NULL),
    ('Dinitrato de isossorbida',   'Dinitrato de isossorbida', 'Comprimido',     '5 mg',       'Sublingual',  NULL);

INSERT INTO atendimento (id, paciente_id, prontuario_id, profissional_id, data_hora, tipo_ocorrencia, local, descricao,
                         pa_sistolica, pa_diastolica, fc, fr, spo2, temperatura, glicemia,
                         glasgow_ocular, glasgow_verbal, glasgow_motora, manchester, start)
SELECT d.id::uuid, p.id, pr.id, prof.id, d.data_hora::timestamptz, d.tipo, d.local, d.descricao,
       d.pas, d.pad, d.fc, d.fr, d.spo2, d.temp, d.glic, d.go, d.gv, d.gm, d.manchester, d.start
FROM (VALUES
    ('7f1c2a10-0000-4000-8000-000000000001', '22233344455', 'SOC-0042', '2026-09-28 08:15-03', 'clinica',
     'Rua Júlio de Castilhos, 1200 - Lajeado', 'Dor torácica há 40 minutos, irradiando para o braço esquerdo.',
     160, 95, 104, 22, 94, 36.6, 180, 4, 5, 6, 'laranja', NULL),
    ('7f1c2a10-0000-4000-8000-000000000002', '33344455566', 'SOC-0042', '2026-10-02 17:40-03', 'acidente_transito',
     'BR-386, km 350', 'Colisão moto x carro. Escoriações em membros inferiores, consciente.',
     125, 80, 98, 20, 97, 36.4, NULL, 4, 5, 6, 'amarelo', 'amarelo'),
    ('7f1c2a10-0000-4000-8000-000000000003', '44455566677', '300003-RS', '2026-10-07 22:05-03', 'clinica',
     'Av. Benjamin Constant, 450 - Lajeado', 'Crise convulsiva relatada por familiar, sonolento na chegada da equipe.',
     138, 88, 92, 18, 96, 37.1, 95, 3, 4, 6, 'amarelo', NULL)
) AS d(id, cpf, registro, data_hora, tipo, local, descricao, pas, pad, fc, fr, spo2, temp, glic, go, gv, gm, manchester, start)
JOIN paciente p ON p.cpf = d.cpf
JOIN prontuario pr ON pr.paciente_id = p.id
JOIN profissional prof ON prof.numero_registro = d.registro;

INSERT INTO medicamento_administrado (atendimento_id, medicamento_id, dose, unidade, via, horario)
SELECT d.atendimento::uuid, m.id, d.dose, d.unidade, d.via, d.horario::timestamptz
FROM (VALUES
    ('7f1c2a10-0000-4000-8000-000000000001', 'AAS',                      200, 'mg', 'VO',         '2026-09-28 08:25-03'),
    ('7f1c2a10-0000-4000-8000-000000000001', 'Dinitrato de isossorbida', 5,   'mg', 'Sublingual', '2026-09-28 08:27-03'),
    ('7f1c2a10-0000-4000-8000-000000000002', 'Soro fisiológico 0,9%',    500, 'mL', 'IV',         '2026-10-02 17:55-03')
) AS d(atendimento, medicamento, dose, unidade, via, horario)
JOIN medicamento m ON m.nome = d.medicamento;
