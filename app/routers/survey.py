from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json
import random

from ..database import get_db
from .. import models, schemas, analytics
from ..profile_defaults import DEFAULT_PROFILE, PROFILE_KEYS

router = APIRouter(prefix="/api/survey", tags=["survey"])


def _study_by_token(token: str, db: Session) -> models.Study:
    study = db.query(models.Study).filter(models.Study.public_token == token).first()
    if not study:
        raise HTTPException(404, "Encuesta no encontrada")
    return study


def _randomize_options(cfg: dict) -> dict:
    """Devuelve una copia de la config con las opciones barajadas,
    manteniendo al final las marcadas como 'anchor' (ej. Ninguno / No sé)."""
    cfg = dict(cfg or {})
    opts = cfg.get("options")
    if isinstance(opts, list) and opts:
        movable = [o for o in opts if not (isinstance(o, dict) and o.get("anchor"))]
        anchored = [o for o in opts if (isinstance(o, dict) and o.get("anchor"))]
        random.shuffle(movable)
        cfg["options"] = movable + anchored
    return cfg


def _serialize_questions(study: models.Study) -> list:
    out = []
    qs = sorted(study.questions, key=lambda x: (x.section != "pre", x.position))
    for q in qs:
        try:
            cfg = json.loads(q.config) if q.config else {}
        except Exception:
            cfg = {}
        if q.randomize and q.qtype in ("single", "multi", "likert"):
            cfg = _randomize_options(cfg)
        out.append({
            "id": q.id, "position": q.position, "section": q.section,
            "qtype": q.qtype, "text": q.text or "",
            "required": bool(q.required), "randomize": bool(q.randomize), "config": cfg,
        })
    return out


@router.get("/{token}/start", response_model=schemas.SurveyStartOut)
def start(token: str, db: Session = Depends(get_db)):
    """Genera las tareas y preguntas para un nuevo encuestado (aún no se guardan)."""
    study = _study_by_token(token, db)
    tasks = analytics.generate_tasks(study) if study.has_conjoint and study.attributes else []
    try:
        cfg = json.loads(study.profile_config) if study.profile_config else DEFAULT_PROFILE
    except Exception:
        cfg = DEFAULT_PROFILE
    return {"study_id": study.id, "study_name": study.name,
            "profile_config": cfg, "has_conjoint": bool(study.has_conjoint),
            "questions": _serialize_questions(study), "tasks": tasks}


@router.post("/{token}/submit")
def submit(token: str, data: schemas.SubmitIn, db: Session = Depends(get_db)):
    """Guarda al encuestado, las pantallas mostradas y la opción elegida."""
    study = _study_by_token(token, db)
    chosen_by_task = {a.task_index: a.chosen_option_index for a in data.answers}

    prof = data.profile or {}
    respondent = models.Respondent(
        study_id=study.id, name=data.name or "Anónimo",
        operator=data.operator or "",
        completed_at=datetime.utcnow(),
    )
    # mapea solo las llaves conocidas del perfil a sus columnas
    for k in PROFILE_KEYS:
        if k in prof and prof[k] is not None:
            setattr(respondent, k, str(prof[k]))
    for task in data.tasks:
        inter = models.Interaction(
            task_index=task.task_index,
            chosen_option_index=chosen_by_task.get(task.task_index),
        )
        for opt in task.options:
            option = models.Option(option_index=opt.option_index)
            for it in opt.items:
                option.items.append(models.OptionItem(
                    attribute_id=it.attribute_id, category_id=it.category_id,
                    attribute_name=it.attribute_name, category_name=it.category_name,
                ))
            inter.options.append(option)
        respondent.interactions.append(inter)

    db.add(respondent)
    db.flush()

    # respuestas de preguntas estándar
    qmap = {q.id: q for q in study.questions}
    for qa in (data.question_answers or []):
        q = qmap.get(qa.question_id)
        ans = models.Answer(
            respondent_id=respondent.id,
            question_id=qa.question_id,
            qtype=qa.qtype or (q.qtype if q else ""),
            question_text=(q.text if q else ""),
            answer_text=(qa.answer_text or ""),
            answer_num=qa.answer_num,
            answer_options=json.dumps(qa.answer_options, ensure_ascii=False) if qa.answer_options is not None else None,
        )
        db.add(ans)

    db.commit()
    return {"ok": True, "respondent_id": respondent.id}
