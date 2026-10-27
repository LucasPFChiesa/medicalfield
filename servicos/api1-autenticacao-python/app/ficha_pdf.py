from datetime import date, datetime
from zoneinfo import ZoneInfo

from fpdf import FPDF

FUSO = ZoneInfo("America/Sao_Paulo")

TIPOS_OCORRENCIA = {
    "clinica": "Clínica", "trauma": "Trauma", "acidente_transito": "Acidente de trânsito",
    "queda": "Queda", "obstetrica": "Obstétrica", "psiquiatrica": "Psiquiátrica", "outra": "Outra",
}


def _texto(valor) -> str:
    """Formata o valor e troca caracteres que a fonte padrão do PDF (Latin-1) não tem."""
    if valor is None or valor == "":
        return "-"
    if isinstance(valor, datetime):
        valor = valor.astimezone(FUSO).strftime("%d/%m/%Y %H:%M")
    elif isinstance(valor, date):
        valor = valor.strftime("%d/%m/%Y")
    return str(valor).encode("latin-1", "replace").decode("latin-1")


class FichaPdf(FPDF):
    def header(self):
        self.set_font("Helvetica", "B", 15)
        self.cell(0, 9, "MedicalField - Ficha de Atendimento", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 9)
        self.set_text_color(90)
        self.cell(0, 5, "Prontuário Médico de Emergência - atendimento pré-hospitalar", new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0)
        self.line(10, self.get_y() + 2, 200, self.get_y() + 2)
        self.ln(5)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(110)
        self.cell(0, 5, _texto(f"Gerado em {datetime.now(FUSO).strftime('%d/%m/%Y %H:%M')} - página {self.page_no()}"), align="R")

    def secao(self, titulo):
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.set_fill_color(225, 236, 240)
        self.cell(0, 7, _texto(titulo), fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def campos(self, pares, colunas=2):
        largura = 190 / colunas
        self.set_font("Helvetica", "", 10)
        for i, (rotulo, valor) in enumerate(pares):
            self.set_font("Helvetica", "B", 9)
            self.cell(largura * 0.42, 6, _texto(rotulo) + ":")
            self.set_font("Helvetica", "", 9)
            fim_da_linha = (i + 1) % colunas == 0 or i == len(pares) - 1
            self.cell(largura * 0.58, 6, _texto(valor),
                      new_x="LMARGIN" if fim_da_linha else "RIGHT",
                      new_y="NEXT" if fim_da_linha else "TOP")

    def paragrafo(self, rotulo, texto):
        self.set_font("Helvetica", "B", 9)
        self.cell(0, 6, _texto(rotulo) + ":", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 9)
        self.multi_cell(0, 5, _texto(texto), new_x="LMARGIN", new_y="NEXT")


def gerar_ficha(at: dict) -> bytes:
    paciente = at["paciente"]
    prontuario = at["prontuario"] or {}
    sexo = {"M": "Masculino", "F": "Feminino", "O": "Outro"}.get(paciente.get("sexo"))

    pdf = FichaPdf()
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()

    pdf.secao("Paciente")
    pdf.campos([
        ("Nome", paciente["nome"]), ("CPF", paciente.get("cpf")),
        ("Nascimento", paciente.get("data_nascimento")), ("Sexo", sexo),
        ("Telefone", paciente.get("telefone")), ("Contato de emergência",
         " ".join(filter(None, [paciente.get("contato_emergencia_nome"), paciente.get("contato_emergencia_telefone")])) or None),
    ])

    pdf.secao("Prontuário")
    pdf.campos([("Tipo sanguíneo", prontuario.get("tipo_sanguineo")), ("Alergias", prontuario.get("alergias"))])
    pdf.campos([("Comorbidades", prontuario.get("comorbidades")), ("Uso contínuo", prontuario.get("uso_continuo"))])

    pdf.secao("Atendimento")
    pdf.campos([
        ("Data e hora", at["data_hora"]), ("Tipo de ocorrência", TIPOS_OCORRENCIA.get(at["tipo_ocorrencia"])),
        ("Profissional", at["profissional_nome"]), ("Registro", at["profissional_registro"]),
    ])
    pdf.campos([("Local", at.get("local"))], colunas=1)
    pdf.paragrafo("Descrição", at["descricao"])

    pdf.secao("Sinais vitais")
    pressao = f"{at['pa_sistolica']}/{at['pa_diastolica']} mmHg" if at.get("pa_sistolica") is not None else None
    pdf.campos([
        ("Pressão arterial", pressao),
        ("Frequência cardíaca", f"{at['fc']} bpm" if at.get("fc") is not None else None),
        ("Frequência respiratória", f"{at['fr']} irpm" if at.get("fr") is not None else None),
        ("SpO2", f"{at['spo2']}%" if at.get("spo2") is not None else None),
        ("Temperatura", f"{float(at['temperatura']):.1f} °C".replace(".", ",") if at.get("temperatura") is not None else None),
        ("Glicemia", f"{at['glicemia']} mg/dL" if at.get("glicemia") is not None else None),
    ])

    pdf.secao("Nível de consciência e triagem")
    glasgow = None
    if at.get("glasgow_total") is not None:
        glasgow = (f"{at['glasgow_total']} (ocular {at['glasgow_ocular']}, verbal {at['glasgow_verbal']}, "
                   f"motora {at['glasgow_motora']})")
    pdf.campos([("Escala de Glasgow", glasgow)], colunas=1)
    pdf.campos([
        ("Manchester", (at.get("manchester") or "").capitalize() or None),
        ("START", (at.get("start") or "").capitalize() or None),
    ])

    pdf.secao("Medicamentos administrados")
    if at["medicamentos"]:
        larguras = [70, 30, 30, 60]
        pdf.set_font("Helvetica", "B", 9)
        for largura, titulo in zip(larguras, ["Medicamento", "Dose", "Via", "Horário"]):
            pdf.cell(largura, 6, _texto(titulo), border=1)
        pdf.ln()
        pdf.set_font("Helvetica", "", 9)
        for m in at["medicamentos"]:
            dose = f"{float(m['dose']):g} {m['unidade']}"
            for largura, valor in zip(larguras, [m["medicamento_nome"], dose, m.get("via"), m["horario"]]):
                pdf.cell(largura, 6, _texto(valor), border=1)
            pdf.ln()
    else:
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 6, "Nenhum medicamento registrado.", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(4)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(110)
    pdf.cell(0, 5, _texto(f"Atendimento {at['id']} - versão {at['versao']}"))
    return bytes(pdf.output())
