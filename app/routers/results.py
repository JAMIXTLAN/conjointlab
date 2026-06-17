import io
import csv
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, auth, analytics
from ..profile_defaults import FIELD_LABELS

router = APIRouter(prefix="/api/studies", tags=["results"])

# Campos por los que se puede segmentar (atributo del modelo Respondent).
SEG_FIELDS = ["sex", "age_group", "occupation", "education",
              "municipality", "district", "electoral_section",
              "locality_zone", "operator"]


def _owned(study_id: str, user, db) -> models.Study:
    study = db.get(models.Study, study_id)
    if not study or study.owner_id != user.id:
        raise HTTPException(404, "Estudio no encontrado")
    return study


def _all_respondents(study, db):
    return db.query(models.Respondent).filter(
        models.Respondent.study_id == study.id).all()


def _segments(respondents):
    """Valores distintos por campo (para los menús de filtro), con conteo."""
    out = []
    for f in SEG_FIELDS:
        counts = {}
        for r in respondents:
            if r.completed_at is None:
                continue
            v = (getattr(r, f, "") or "").strip()
            if v:
                counts[v] = counts.get(v, 0) + 1
        if counts:
            out.append({
                "field": f, "label": FIELD_LABELS.get(f, f),
                "values": [{"value": k, "n": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])],
            })
    return out


def _question_results(study, subset):
    """Tabula cada pregunta estándar sobre el subconjunto de entrevistados."""
    subset_ids = {r.id for r in subset}
    # recopila respuestas por pregunta
    by_q = {}
    for r in subset:
        for a in r.answers:
            by_q.setdefault(a.question_id, []).append(a)
    out = []
    qs = sorted(study.questions, key=lambda x: (x.section != "pre", x.position))
    for q in qs:
        try:
            cfg = json.loads(q.config) if q.config else {}
        except Exception:
            cfg = {}
        answers = by_q.get(q.id, [])
        n = len(answers)
        item = {"id": q.id, "qtype": q.qtype, "text": q.text or "",
                "section": q.section, "n": n}
        if q.qtype == "open":
            item["responses"] = [a.answer_text for a in answers if (a.answer_text or "").strip()]
        elif q.qtype in ("single", "multi", "likert"):
            counts = {}
            for a in answers:
                try:
                    chosen = json.loads(a.answer_options) if a.answer_options else []
                except Exception:
                    chosen = []
                for opt in chosen:
                    counts[opt] = counts.get(opt, 0) + 1
            # ordena según las opciones definidas (si existen), si no por frecuencia
            defined = [o.get("text") if isinstance(o, dict) else o for o in (cfg.get("options") or [])]
            img_map = {}
            for o in (cfg.get("options") or []):
                if isinstance(o, dict) and o.get("text") and o.get("image"):
                    img_map[o["text"]] = o["image"]
            ordered = [t for t in defined if t in counts] + [t for t in counts if t not in defined]
            base = n if q.qtype != "multi" else max(1, n)
            item["options"] = [{"text": t, "count": counts.get(t, 0),
                                "pct": (counts.get(t, 0) / base if base else 0),
                                "image": img_map.get(t, "")} for t in (ordered or counts.keys())]
            item["multi"] = (q.qtype == "multi")
        elif q.qtype == "numeric":
            nums = [a.answer_num for a in answers if a.answer_num is not None]
            if nums:
                item["mean"] = sum(nums) / len(nums)
                item["min"] = min(nums)
                item["max"] = max(nums)
                item["count"] = len(nums)
                # distribución por valor entero
                dist = {}
                for v in nums:
                    k = round(v)
                    dist[k] = dist.get(k, 0) + 1
                item["dist"] = [{"value": k, "count": dist[k]} for k in sorted(dist)]
            else:
                item["mean"] = None; item["count"] = 0; item["dist"] = []
        out.append(item)
    return out


def _results(study, db, seg_field=None, seg_value=None):
    respondents = _all_respondents(study, db)
    segments = _segments(respondents)
    subset = respondents
    applied = None
    if seg_field and seg_value and seg_field in SEG_FIELDS:
        subset = [r for r in respondents if (getattr(r, seg_field, "") or "").strip() == seg_value]
        applied = {"field": seg_field, "label": FIELD_LABELS.get(seg_field, seg_field), "value": seg_value}
    res = analytics.compute_results(study, subset)
    res["segments"] = segments
    res["applied_filter"] = applied
    res["has_conjoint"] = bool(study.has_conjoint)
    res["has_questions"] = len(study.questions) > 0
    # total de entrevistados completados en el subconjunto (sirve para estudios solo-encuesta)
    res["n_respondents"] = sum(1 for r in subset if r.completed_at is not None)
    res["question_results"] = _question_results(study, [r for r in subset if r.completed_at is not None])
    return res


@router.get("/{study_id}/results")
def results(study_id: str, seg_field: str = Query(None), seg_value: str = Query(None),
            user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    return _results(_owned(study_id, user, db), db, seg_field, seg_value)


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
    respondents = _all_respondents(study, db)
    attrs = study.attributes
    wb = Workbook()

    ws = wb.active
    ws.title = "Resumen"
    ws.append(["Métrica", "Valor"])
    ws.append(["Estudio", study.name])
    ws.append(["Encuestados con respuesta", R["n_responses"]])
    ws.append(["Total de elecciones", R["total_choices"]])
    ws.append(["Atributos", R["attribute_count"]])
    ws.append(["Exportado", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")])

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

    # Hoja: entrevistados (perfil completo, una fila por persona)
    wsR = wb.create_sheet("Entrevistados")
    wsR.append(["ID entrevistado", "Fecha y hora", "Encuestador", "Sexo", "Edad",
                "Ocupación", "Escolaridad", "Municipio", "Distrito",
                "Sección electoral", "Localidad / colonia / zona"])
    for r in respondents:
        wsR.append([
            r.id, r.completed_at.strftime("%Y-%m-%d %H:%M") if r.completed_at else "",
            r.operator or "", r.sex or "", r.age_group or "", r.occupation or "",
            r.education or "", r.municipality or "", r.district or "",
            r.electoral_section or "", r.locality_zone or "",
        ])

    # Hoja: una fila por interacción con perfil + alternativa elegida
    ws5 = wb.create_sheet("Por interacción")
    ws5.append(["ID entrevistado", "Encuestador", "Sexo", "Edad", "Ocupación", "Escolaridad",
                "Municipio", "Distrito", "Sección electoral", "Localidad",
                "Interacción"] + [a.name for a in attrs])
    for r in respondents:
        base = [r.id, r.operator or "", r.sex or "", r.age_group or "", r.occupation or "",
                r.education or "", r.municipality or "", r.district or "",
                r.electoral_section or "", r.locality_zone or ""]
        for inter in sorted(r.interactions, key=lambda x: x.task_index):
            chosen = next((o for o in inter.options
                           if o.option_index == inter.chosen_option_index), None)
            by_attr = {it.attribute_id: it.category_name for it in chosen.items} if chosen else {}
            ws5.append(base + [inter.task_index + 1] + [by_attr.get(a.id, "") for a in attrs])

    # Hoja: resumen por encuestador
    ws6 = wb.create_sheet("Por operador")
    ws6.append(["Operador", "Entrevistas completadas", "Elecciones registradas"])
    for o in R.get("by_operator", []):
        ws6.append([o["operator"], o["respondents"], o["choices"]])

    # ----- Cuestionario estándar -----
    if study.questions:
        qs = sorted(study.questions, key=lambda x: (x.section != "pre", x.position))
        # Resumen por pregunta
        wsq = wb.create_sheet("Cuestionario (resumen)")
        for qr in R.get("question_results", []):
            wsq.append([f'[{qr["qtype"]}] {qr["text"]}'])
            if qr["qtype"] == "open":
                wsq.append(["Respuestas abiertas:", qr.get("n", 0)])
                for txt in qr.get("responses", []):
                    wsq.append(["", txt])
            elif qr["qtype"] in ("single", "multi", "likert"):
                wsq.append(["Opción", "Conteo", "%"])
                for o in qr.get("options", []):
                    wsq.append([o["text"], o["count"], round(o["pct"] * 100, 1)])
            elif qr["qtype"] == "numeric":
                wsq.append(["Promedio", round(qr["mean"], 2) if qr.get("mean") is not None else ""])
                wsq.append(["Mín", qr.get("min", ""), "Máx", qr.get("max", ""), "n", qr.get("count", 0)])
            wsq.append([])

        # Crudo: una fila por entrevistado, una columna por pregunta
        wsr = wb.create_sheet("Cuestionario (crudo)")
        headers = ["ID entrevistado", "Encuestador"] + [f"{q.text}" for q in qs]
        wsr.append(headers)
        for r in respondents:
            if r.completed_at is None:
                continue
            amap = {}
            for a in r.answers:
                if a.qtype == "open":
                    amap[a.question_id] = a.answer_text or ""
                elif a.qtype == "numeric":
                    amap[a.question_id] = a.answer_num if a.answer_num is not None else ""
                else:
                    try:
                        opts = json.loads(a.answer_options) if a.answer_options else []
                    except Exception:
                        opts = []
                    amap[a.question_id] = " | ".join(opts)
            wsr.append([r.id, r.operator or ""] + [amap.get(q.id, "") for q in qs])

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return StreamingResponse(
        bio, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{study.name}_resultados.xlsx"'},
    )
