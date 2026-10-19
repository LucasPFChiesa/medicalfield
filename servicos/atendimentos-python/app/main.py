from fastapi import FastAPI

app = FastAPI(title="MedicalField - Atendimentos", version="0.1.0")


@app.get("/saude")
def verificar_saude() -> dict[str, str]:
    return {"servico": "atendimentos", "status": "ok"}

