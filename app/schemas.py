"""Esquemas Pydantic (validación y serialización)."""
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field


# ---------- auth ----------
class RegisterIn(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=4)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str


class TokenOut(BaseModel):
    token: str
    user: UserOut


# ---------- estudios ----------
class CategoryIn(BaseModel):
    name: str


class AttributeIn(BaseModel):
    name: str
    categories: List[CategoryIn]


class QuestionIn(BaseModel):
    position: int = 0
    section: str = "pre"           # pre | post
    qtype: str = "single"          # open | single | multi | likert | numeric
    text: str = ""
    required: bool = False
    randomize: bool = False
    config: Optional[dict] = None  # opciones / escala / rango


class QuestionOut(QuestionIn):
    id: str


class StudyIn(BaseModel):
    name: str
    num_respondents: int = 50
    tasks_per_respondent: int = 8
    options_per_task: int = 3
    attributes: List[AttributeIn]
    profile_config: Optional[dict] = None
    has_conjoint: bool = True
    questions: Optional[List[QuestionIn]] = None


class CategoryOut(BaseModel):
    id: str
    name: str


class AttributeOut(BaseModel):
    id: str
    name: str
    categories: List[CategoryOut]


class StudyOut(BaseModel):
    id: str
    name: str
    num_respondents: int
    tasks_per_respondent: int
    options_per_task: int
    public_token: str
    attributes: List[AttributeOut]
    profile_config: Optional[dict] = None
    has_conjoint: bool = True
    questions: List[QuestionOut] = []
    response_count: int = 0


class StudySummary(BaseModel):
    id: str
    name: str
    num_respondents: int
    tasks_per_respondent: int
    options_per_task: int
    public_token: str
    attribute_count: int
    category_count: int
    response_count: int


# ---------- encuesta ----------
class OptionItemOut(BaseModel):
    attribute_id: str
    attribute_name: str
    category_id: str
    category_name: str


class OptionOut(BaseModel):
    option_index: int
    items: List[OptionItemOut]


class TaskOut(BaseModel):
    task_index: int
    options: List[OptionOut]


class SurveyStartOut(BaseModel):
    study_id: str
    study_name: str
    profile_config: Optional[dict] = None
    has_conjoint: bool = True
    questions: List[QuestionOut] = []   # ya vienen con opciones aleatorizadas si aplica
    tasks: List[TaskOut]


class AnswerIn(BaseModel):
    task_index: int
    chosen_option_index: int


class QuestionAnswerIn(BaseModel):
    question_id: str
    qtype: str = ""
    answer_text: Optional[str] = None
    answer_num: Optional[float] = None
    answer_options: Optional[List[str]] = None


class SubmitIn(BaseModel):
    name: Optional[str] = "Anónimo"
    operator: Optional[str] = ""
    profile: Optional[dict] = None         # {sex, age_group, occupation, ...}
    question_answers: Optional[List[QuestionAnswerIn]] = None
    tasks: List[TaskOut] = []              # mismas tareas que devolvió /start
    answers: List[AnswerIn] = []           # una respuesta por tarea conjoint
