from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json

from ..database import get_db
from .. import models, schemas, analytics
from ..profile_defaults import DEFAULT_PROFILE, PROFILE_KEYS

router = APIRouter(prefix="/api/survey", tags=["survey"])


def _study_by_token(token: str, db: Session) -> models.Study:
    study = db.query(models.Study).filter(models.Study.public_token == token).first()
    if not study:
        raise HTTPException(404, "Encuesta no encontrada")
    return study


@router.get("/{token}/start", response_model=schemas.SurveyStartOut)
def start(token: str, db: Session = Depends(get_db)):
    """Genera las tareas para un nuevo encuestado (aún no se guardan)."""
    study = _study_by_token(token, db)
    tasks = analytics.generate_tasks(study)
    try:
        cfg = json.loads(study.profile_config) if study.profile_config else DEFAULT_PROFILE
    except Exception:
        cfg = DEFAULT_PROFILE
    return {"study_id": study.id, "study_name": study.name,
            "profile_config": cfg, "tasks": tasks}


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
    db.commit()
    return {"ok": True, "respondent_id": respondent.id}
