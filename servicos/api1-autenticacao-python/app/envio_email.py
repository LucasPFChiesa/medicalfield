import os
import smtplib
from email.message import EmailMessage


def enviar_ficha(destinatario: str, paciente_nome: str, pdf: bytes, nome_arquivo: str):
    """Envia a ficha em anexo pelo servidor SMTP configurado no ambiente (SMTP_*)."""
    mensagem = EmailMessage()
    mensagem["From"] = os.environ.get("SMTP_REMETENTE") or os.environ["SMTP_USUARIO"]
    mensagem["To"] = destinatario
    mensagem["Subject"] = f"MedicalField - Ficha de atendimento de {paciente_nome}"
    mensagem.set_content(
        f"Olá,\n\nSegue em anexo a ficha do atendimento pré-hospitalar de {paciente_nome}.\n\n"
        "Esta mensagem foi enviada automaticamente pelo MedicalField."
    )
    mensagem.add_attachment(pdf, maintype="application", subtype="pdf", filename=nome_arquivo)

    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORTA", "587")), timeout=20) as smtp:
        smtp.starttls()
        smtp.login(os.environ["SMTP_USUARIO"], os.environ["SMTP_SENHA"])
        smtp.send_message(mensagem)
