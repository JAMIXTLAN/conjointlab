from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
import json

from ..database import get_db
from .. import models, schemas, auth, analytics
from ..profile_defaults import DEFAULT_PROFILE

router = APIRouter(prefix="/api/studies", tags=["studies"])


def _q_serialize(q: models.Question) -> dict:
    try:
        cfg = json.loads(q.config) if q.config else {}
    except Exception:
        cfg = {}
    return {
        "id": q.id, "position": q.position, "section": q.section,
        "qtype": q.qtype, "text": q.text or "",
        "required": bool(q.required), "randomize": bool(q.randomize),
        "config": cfg,
    }


def _serialize(study: models.Study, db: Session) -> dict:
    rc = db.query(models.Respondent).filter(
        models.Respondent.study_id == study.id,
        models.Respondent.completed_at.isnot(None),
    ).count()
    try:
        cfg = json.loads(study.profile_config) if study.profile_config else DEFAULT_PROFILE
    except Exception:
        cfg = DEFAULT_PROFILE
    return {
        "id": study.id, "name": study.name,
        "num_respondents": study.num_respondents,
        "tasks_per_respondent": study.tasks_per_respondent,
        "options_per_task": study.options_per_task,
        "public_token": study.public_token,
        "profile_config": cfg,
        "has_conjoint": bool(study.has_conjoint),
        "questions": [_q_serialize(q) for q in sorted(study.questions, key=lambda x: (x.section != "pre", x.position))],
        "attributes": [
            {"id": a.id, "name": a.name,
             "categories": [{"id": c.id, "name": c.name} for c in a.categories]}
            for a in study.attributes
        ],
        "response_count": rc,
    }


def _apply_questions(study: models.Study, data):
    """Reemplaza las preguntas del estudio con las recibidas."""
    if data.questions is None:
        return
    study.questions.clear()
    for qi, q in enumerate(data.questions):
        study.questions.append(models.Question(
            position=q.position if q.position is not None else qi,
            section=q.section or "pre",
            qtype=q.qtype or "single",
            text=q.text or "",
            required=bool(q.required),
            randomize=bool(q.randomize),
            config=json.dumps(q.config or {}, ensure_ascii=False),
        ))


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
    if data.has_conjoint and len(data.attributes) < 2:
        raise HTTPException(400, "Un estudio con conjoint necesita al menos 2 atributos")
    has_q = bool(data.questions)
    if not data.has_conjoint and not has_q:
        raise HTTPException(400, "El estudio debe tener conjoint o al menos una pregunta")
    study = models.Study(
        owner_id=user.id, name=data.name, num_respondents=data.num_respondents,
        tasks_per_respondent=data.tasks_per_respondent, options_per_task=data.options_per_task,
        profile_config=json.dumps(data.profile_config or DEFAULT_PROFILE, ensure_ascii=False),
        has_conjoint=bool(data.has_conjoint),
    )
    for ai, a in enumerate(data.attributes):
        attr = models.Attribute(name=a.name, position=ai)
        for ci, c in enumerate(a.categories):
            attr.categories.append(models.Category(name=c.name, position=ci))
        study.attributes.append(attr)
    _apply_questions(study, data)
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
    study.has_conjoint = bool(data.has_conjoint)
    if data.profile_config is not None:
        study.profile_config = json.dumps(data.profile_config, ensure_ascii=False)
    # reemplaza atributos/categorías (simple para el MVP)
    study.attributes.clear()
    db.flush()
    for ai, a in enumerate(data.attributes):
        attr = models.Attribute(name=a.name, position=ai)
        for ci, c in enumerate(a.categories):
            attr.categories.append(models.Category(name=c.name, position=ci))
        study.attributes.append(attr)
    _apply_questions(study, data)
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
