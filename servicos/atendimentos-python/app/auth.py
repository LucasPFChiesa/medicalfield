import os

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# O token é emitido pelo serviço de cadastros; aqui ele só é validado com o
# mesmo segredo, sem consultar o outro serviço.
bearer = HTTPBearer(auto_error=False)


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
