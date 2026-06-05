import io
import csv
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, auth, analytics

router = APIRouter(prefix="/api/studies", tags=["results"])


def _owned(study_id: str, user, db) -> models.Study:
    study = db.get(models.Study, study_id)
    if not study or study.owner_id != user.id:
        raise HTTPException(404, "Estudio no encontrado")
    return study


def _results(study, db):
    respondents = db.query(models.Respondent).filter(
        models.Respondent.study_id == study.id).all()
    return analytics.compute_results(study, respondents)


@router.get("/{study_id}/results")
def results(study_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    return _results(_owned(study_id, user, db), db)


@router.get("/{study_id}/export.csv")
def export_csv(study_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    study = _owned(study_id, user, db)
    R = _results(study, db)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Atributo", "Categoria", "Veces mostrada", "Veces elegida",
                "% eleccion (del atributo)", "Tasa preferencia %"])
    for a in R["by_attribute"]:
        for c in a["categories"]:
            w.writerow([a["attribute_name"], c["category_name"], c["shown"], c["chosen"],
                        round(c["share"] * 100, 2), round(c["win_rate"] * 100, 2)])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{study.name}_categorias.csv"'},
    )


@router.get("/{study_id}/export.xlsx")
def export_xlsx(study_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    from openpyxl import Workbook
    study = _owned(study_id, user, db)
    R = _results(study, db)
    wb = Workbook()

    ws = wb.active
    ws.title = "Resumen"
    ws.append(["Métrica", "Valor"])
    ws.append(["Estudio", study.name])
    ws.append(["Encuestados con respuesta", R["n_responses"]])
    ws.append(["Total de elecciones", R["total_choices"]])
    ws.append(["Atributos", R["attribute_count"]])

    ws2 = wb.create_sheet("Por categoría")
    ws2.append(["Atributo", "Categoría", "Veces mostrada", "Veces elegida", "% elección", "Tasa preferencia %"])
    for a in R["by_attribute"]:
        for c in a["categories"]:
            ws2.append([a["attribute_name"], c["category_name"], c["shown"], c["chosen"],
                        round(c["share"] * 100, 2), round(c["win_rate"] * 100, 2)])

    ws3 = wb.create_sheet("Ranking categorías")
    ws3.append(["#", "Atributo", "Categoría", "Tasa preferencia %", "Veces elegida", "Veces mostrada"])
    for i, c in enumerate(R["all_categories"], 1):
        ws3.append([i, c["attribute_name"], c["category_name"],
                    round(c["win_rate"] * 100, 2), c["chosen"], c["shown"]])

    ws4 = wb.create_sheet("Combinaciones")
    ws4.append(["#", "Combinación", "Veces mostrada", "Veces elegida", "% del total", "Tasa de victoria %"])
    for i, c in enumerate(R["combos"], 1):
        ws4.append([i, c["label"], c["shown"], c["chosen"],
                    round(c["share"] * 100, 2), round(c["win_rate"] * 100, 2)])

    # Hoja: una fila por interacción, una columna por atributo (respuesta elegida)
    respondents = db.query(models.Respondent).filter(
        models.Respondent.study_id == study.id).all()
    attrs = study.attributes  # orden definido en el estudio
    ws5 = wb.create_sheet("Por interacción")
    ws5.append(["Usuario", "Operador", "Interacción"] + [a.name for a in attrs] + ["Edad", "Sexo", "Municipio"])
    for r in respondents:
        for inter in sorted(r.interactions, key=lambda x: x.task_index):
            chosen = next((o for o in inter.options
                           if o.option_index == inter.chosen_option_index), None)
            by_attr = {it.attribute_id: it.category_name for it in chosen.items} if chosen else {}
            ws5.append(
                [r.name, r.operator or "", inter.task_index + 1]
                + [by_attr.get(a.id, "") for a in attrs]
                + [r.age, r.sex, r.municipality]
            )

    # Hoja: resumen por operador
    ws6 = wb.create_sheet("Por operador")
    ws6.append(["Operador", "Entrevistas completadas", "Elecciones registradas"])
    for o in R.get("by_operator", []):
        ws6.append([o["operator"], o["respondents"], o["choices"]])

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return StreamingResponse(
        bio, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{study.name}_resultados.xlsx"'},
    )

