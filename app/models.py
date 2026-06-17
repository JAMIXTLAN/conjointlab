"""Modelos de la base de datos para estudios conjoint."""
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, DateTime, ForeignKey, Text, Boolean, Float,
)
from sqlalchemy.orm import relationship
from .database import Base


def _uuid():
    return uuid.uuid4().hex


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    studies = relationship("Study", back_populates="owner", cascade="all, delete-orphan")


class Study(Base):
    __tablename__ = "studies"
    id = Column(String, primary_key=True, default=_uuid)
    owner_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    num_respondents = Column(Integer, default=50)        # meta de entrevistados
    tasks_per_respondent = Column(Integer, default=8)    # tareas/pantallas por persona
    options_per_task = Column(Integer, default=3)        # opciones por pantalla
    public_token = Column(String, unique=True, index=True, default=_uuid)  # link público
    profile_config = Column(Text, nullable=True)  # JSON con la config de campos de perfil
    has_conjoint = Column(Boolean, default=True)   # si el estudio incluye el bloque conjoint
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="studies")
    attributes = relationship(
        "Attribute", back_populates="study",
        cascade="all, delete-orphan", order_by="Attribute.position",
    )
    questions = relationship(
        "Question", back_populates="study",
        cascade="all, delete-orphan", order_by="Question.position",
    )
    respondents = relationship(
        "Respondent", back_populates="study", cascade="all, delete-orphan",
    )


class Attribute(Base):
    __tablename__ = "attributes"
    id = Column(String, primary_key=True, default=_uuid)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    position = Column(Integer, default=0)

    study = relationship("Study", back_populates="attributes")
    categories = relationship(
        "Category", back_populates="attribute",
        cascade="all, delete-orphan", order_by="Category.position",
    )


class Category(Base):
    __tablename__ = "categories"
    id = Column(String, primary_key=True, default=_uuid)
    attribute_id = Column(String, ForeignKey("attributes.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    position = Column(Integer, default=0)

    attribute = relationship("Attribute", back_populates="categories")


class Respondent(Base):
    __tablename__ = "respondents"
    id = Column(String, primary_key=True, default=_uuid)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"))
    name = Column(String, default="Anónimo")
    operator = Column(String, default="")   # encuestador que capturó
    # --- Sociodemográficos ---
    sex = Column(String, default="")
    age_group = Column(String, default="")
    occupation = Column(String, default="")
    education = Column(String, default="")
    # --- Territoriales ---
    municipality = Column(String, default="")
    district = Column(String, default="")
    electoral_section = Column(String, default="")
    locality_zone = Column(String, default="")
    # compatibilidad anterior
    age = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    study = relationship("Study", back_populates="respondents")
    interactions = relationship(
        "Interaction", back_populates="respondent", cascade="all, delete-orphan",
    )
    answers = relationship(
        "Answer", back_populates="respondent", cascade="all, delete-orphan",
    )


class Interaction(Base):
    """Una pantalla/tarea mostrada al encuestado."""
    __tablename__ = "interactions"
    id = Column(String, primary_key=True, default=_uuid)
    respondent_id = Column(String, ForeignKey("respondents.id", ondelete="CASCADE"))
    task_index = Column(Integer, default=0)
    chosen_option_index = Column(Integer, nullable=True)  # opción elegida

    respondent = relationship("Respondent", back_populates="interactions")
    options = relationship(
        "Option", back_populates="interaction",
        cascade="all, delete-orphan", order_by="Option.option_index",
    )


class Option(Base):
    """Una opción/combinación dentro de una pantalla."""
    __tablename__ = "options"
    id = Column(String, primary_key=True, default=_uuid)
    interaction_id = Column(String, ForeignKey("interactions.id", ondelete="CASCADE"))
    option_index = Column(Integer, default=0)

    interaction = relationship("Interaction", back_populates="options")
    items = relationship(
        "OptionItem", back_populates="option", cascade="all, delete-orphan",
    )


class OptionItem(Base):
    """Cada par (atributo, categoría) que compone una opción."""
    __tablename__ = "option_items"
    id = Column(String, primary_key=True, default=_uuid)
    option_id = Column(String, ForeignKey("options.id", ondelete="CASCADE"))
    attribute_id = Column(String, ForeignKey("attributes.id", ondelete="CASCADE"))
    category_id = Column(String, ForeignKey("categories.id", ondelete="CASCADE"))
    attribute_name = Column(String)   # desnormalizado para reportes simples
    category_name = Column(String)

    option = relationship("Option", back_populates="items")


class Question(Base):
    """Pregunta de cuestionario estándar (no conjoint)."""
    __tablename__ = "questions"
    id = Column(String, primary_key=True, default=_uuid)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"))
    position = Column(Integer, default=0)        # orden dentro de su sección
    section = Column(String, default="pre")      # "pre" (antes) | "post" (después del conjoint)
    qtype = Column(String, default="single")     # open | single | multi | likert | numeric
    text = Column(Text, default="")
    required = Column(Boolean, default=False)
    randomize = Column(Boolean, default=False)   # aleatorizar opciones (single/multi/likert)
    config = Column(Text, nullable=True)         # JSON con opciones / escala / rango

    study = relationship("Study", back_populates="questions")


class Answer(Base):
    """Respuesta de un entrevistado a una pregunta estándar."""
    __tablename__ = "answers"
    id = Column(String, primary_key=True, default=_uuid)
    respondent_id = Column(String, ForeignKey("respondents.id", ondelete="CASCADE"))
    question_id = Column(String, ForeignKey("questions.id", ondelete="SET NULL"), nullable=True)
    qtype = Column(String, default="")           # desnormalizado
    question_text = Column(Text, default="")     # desnormalizado para export
    answer_text = Column(Text, default="")       # abiertas
    answer_num = Column(Float, nullable=True)    # numérica / likert (valor)
    answer_options = Column(Text, nullable=True) # JSON: lista de opciones elegidas (single/multi/likert)

    respondent = relationship("Respondent", back_populates="answers")
