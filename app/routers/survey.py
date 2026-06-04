from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, analytics

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
    return {"study_id": study.id, "study_name": study.name, "tasks": tasks}


@router.post("/{token}/submit")
def submit(token: str, data: schemas.SubmitIn, db: Session = Depends(get_db)):
    """Guarda al encuestado, las pantallas mostradas y la opción elegida."""
    study = _study_by_token(token, db)
    chosen_by_task = {a.task_index: a.chosen_option_index for a in data.answers}

    respondent = models.Respondent(
        study_id=study.id, name=data.name or "Anónimo",
        operator=data.operator or "",
        age=data.age or "", sex=data.sex or "", municipality=data.municipality or "",
        completed_at=datetime.utcnow(),
    )
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
