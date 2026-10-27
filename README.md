# MedicalField

Trabalho final de Arquiteturas de Software (Univates, 2026/B).

Sistema de registro de atendimentos pré-hospitalares que funciona sem internet. O socorrista cadastra pacientes, prontuários e atendimentos no app, e os dados são sincronizados com o servidor quando a conexão volta.

Endereço: **https://medicalfield.duckdns.org**

- App do socorrista: `/socorrista/`
- Portal administrativo: `/portal/`
- Swagger das APIs: `/docs/`

Login de teste: tipo **CRM**, número **admin**, senha **admin**.

| Profissional | Tipo | Número | Perfil |
|---|---|---|---|
| Lucas Chiesa | CRM | admin | admin |
| Médico Teste | CRM | medico | médico |
| Enfermeiro Teste | COREN | enfermeiro | enfermeiro |
| Socorrista Teste | SOCORRISTA | socorrista | socorrista |

Todos usam a senha `admin`.

## Estrutura

```
servicos/api1-autenticacao-python/  login, profissionais, logs, PDF e e-mail
servicos/api2-prontuarios-go/       prontuários e sincronização
servicos/api3-atendimentos-node/    pessoas, medicamentos e atendimentos
web/                                app do socorrista, portal e Swagger
banco/                              tabelas, permissões e dados de exemplo
implantacao/                        Nginx, systemd e instalação na VM
testes/                             integração e roteiro dos 17 passos
postman/                            coleção com as rotas
```

## Configuração

As senhas ficam no `.env`, que não vai para o git. O modelo está em `.env.exemplo`.

## Atualizar a VM

```bash
./iniciar-vm.sh
```

Envia o código, reinstala e reinicia as três APIs e confere se respondem.

Para voltar o banco aos dados de exemplo, na VM:

```bash
cd /opt/medicalfield && banco/criar_banco.sh --recriar
```

## Testes

```bash
testes/rodar_testes.sh                            # testes das APIs e integração (na VM)
cd testes && npx playwright test                  # roteiro dos 17 passos no Chrome
postman collection run postman/MedicalField.postman_collection.json
```
