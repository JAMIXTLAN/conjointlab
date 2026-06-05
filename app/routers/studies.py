from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth, analytics

router = APIRouter(prefix="/api/studies", tags=["studies"])


def _serialize(study: models.Study, db: Session) -> dict:
    rc = db.query(models.Respondent).filter(
        models.Respondent.study_id == study.id,
        models.Respondent.completed_at.isnot(None),
    ).count()
    return {
        "id": study.id, "name": study.name,
        "num_respondents": study.num_respondents,
        "tasks_per_respondent": study.tasks_per_respondent,
        "options_per_task": study.options_per_task,
        "public_token": study.public_token,
        "attributes": [
            {"id": a.id, "name": a.name,
             "categories": [{"id": c.id, "name": c.name} for c in a.categories]}
            for a in study.attributes
        ],
        "response_count": rc,
    }


def _owned(study_id: str, user, db) -> models.Study:
    study = db.get(models.Study, study_id)
    if not study or study.owner_id != user.id:
        raise HTTPException(404, "Estudio no encontrado")
    return study


@router.get("", response_model=list[schemas.StudySummary])
def list_studies(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    out = []
    for s in db.query(models.Study).filter(models.Study.owner_id == user.id).order_by(models.Study.created_at.desc()):
        rc = db.query(models.Respondent).filter(
            models.Respondent.study_id == s.id, models.Respondent.completed_at.isnot(None),
        ).count()
        out.append({
            "id": s.id, "name": s.name, "num_respondents": s.num_respondents,
            "tasks_per_respondent": s.tasks_per_respondent, "options_per_task": s.options_per_task,
            "public_token": s.public_token,
            "attribute_count": len(s.attributes),
            "category_count": sum(len(a.categories) for a in s.attributes),
            "response_count": rc,
        })
    return out


@router.post("", response_model=schemas.StudyOut)
def create_study(data: schemas.StudyIn, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    if len(data.attributes) < 2:
        raise HTTPException(400, "Se necesitan al menos 2 atributos")
    study = models.Study(
        owner_id=user.id, name=data.name, num_respondents=data.num_respondents,
        tasks_per_respondent=data.tasks_per_respondent, options_per_task=data.options_per_task,
    )
    for ai, a in enumerate(data.attributes):
        attr = models.Attribute(name=a.name, position=ai)
        for ci, c in enumerate(a.categories):
            attr.categories.append(models.Category(name=c.name, position=ci))
        study.attributes.append(attr)
    db.add(study)
    db.commit()
    db.refresh(study)
    return _serialize(study, db)


@router.get("/{study_id}", response_model=schemas.StudyOut)
def get_study(study_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    return _serialize(_owned(study_id, user, db), db)


@router.put("/{study_id}", response_model=schemas.StudyOut)
def update_study(study_id: str, data: schemas.StudyIn, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    study = _owned(study_id, user, db)
    study.name = data.name
    study.num_respondents = data.num_respondents
    study.tasks_per_respondent = data.tasks_per_respondent
    study.options_per_task = data.options_per_task
    # reemplaza atributos/categorías (simple para el MVP)
    study.attributes.clear()
    db.flush()
    for ai, a in enumerate(data.attributes):
        attr = models.Attribute(name=a.name, position=ai)
        for ci, c in enumerate(a.categories):
            attr.categories.append(models.Category(name=c.name, position=ci))
        study.attributes.append(attr)
    db.commit()
    db.refresh(study)
    return _serialize(study, db)


@router.delete("/{study_id}")
def delete_study(study_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    study = _owned(study_id, user, db)
    db.delete(study)
    db.commit()
    return {"ok": True}


@router.get("/{study_id}/scenarios")
def preview_scenarios(study_id: str, count: int = Query(5, ge=1, le=50),
                      user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Vista previa de combinaciones generadas (no se persisten)."""
    study = _owned(study_id, user, db)
    fake = type("S", (), {"attributes": study.attributes,
                          "tasks_per_respondent": count, "options_per_task": study.options_per_task})()
    return {"possible": analytics.total_possible(study.attributes),
            "tasks": analytics.generate_tasks(fake)}

