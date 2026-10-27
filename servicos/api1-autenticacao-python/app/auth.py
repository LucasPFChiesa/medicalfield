import os
import time

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# Autenticação do MedicalField.
# A API 1 é a única que emite tokens: no login, compara a senha com o hash
# bcrypt guardado em profissional.senha_hash e devolve um JWT assinado com
# JWT_SEGREDO. As APIs 2 e 3 conhecem o mesmo segredo e só validam a
# assinatura, sem consultar esta API a cada requisição.

VALIDADE_SEGUNDOS = 8 * 60 * 60
bearer = HTTPBearer(auto_error=False)


def senha_confere(senha: str, senha_hash: str) -> bool:
    return bcrypt.checkpw(senha.encode(), senha_hash.encode())


def gerar_hash(senha: str) -> str:
    return bcrypt.hashpw(senha.encode(), bcrypt.gensalt(10)).decode()


def emitir_token(profissional: dict) -> str:
    dados = {
        "sub": str(profissional["id"]),
        "nome": profissional["nome"],
        "perfil": profissional["perfil"],
        "exp": int(time.time()) + VALIDADE_SEGUNDOS,
    }
    return jwt.encode(dados, os.environ["JWT_SEGREDO"], algorithm="HS256")


# Dependência usada pelas rotas protegidas: exige "Authorization: Bearer <token>".
def profissional_atual(request: Request, credenciais: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if credenciais is None:
        raise HTTPException(401, "Token não informado")
    try:
        dados = jwt.decode(credenciais.credentials, os.environ["JWT_SEGREDO"], algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Token inválido ou expirado")
    request.state.profissional_id = dados["sub"]
    return dados


def exigir_admin(profissional: dict = Depends(profissional_atual)) -> dict:
    if profissional["perfil"] != "admin":
        raise HTTPException(403, "Seu perfil não tem permissão para esta operação")
    return profissional
