"""Configuración por defecto del módulo de perfil del entrevistado.

Cada campo tiene una 'key' fija (que corresponde a una columna en la tabla
respondents). El administrador puede, por estudio: activar/desactivar el campo,
marcarlo obligatorio u opcional y editar las opciones de los menús cerrados.
"""

# Campos cuyo valor se guarda en columnas de la tabla respondents.
PROFILE_KEYS = [
    "sex", "age_group", "occupation", "education",
    "municipality", "district", "electoral_section", "locality_zone",
]

DEFAULT_PROFILE = {
    "fields": [
        {
            "key": "sex", "label": "Sexo", "type": "single",
            "enabled": True, "required": True,
            "options": ["Hombre", "Mujer", "Otro", "Prefiere no decir"],
        },
        {
            "key": "age_group", "label": "Edad", "type": "single",
            "enabled": True, "required": True,
            "options": ["Menos de 18", "18 a 35", "36 a 50", "51 a 60", "61 y más"],
        },
        {
            "key": "occupation", "label": "Ocupación", "type": "single",
            "enabled": True, "required": False,
            "options": [
                "Ama de casa", "Estudiante", "Empleado/a del sector privado",
                "Empleado/a de gobierno", "Comerciante", "Empresario/a",
                "Trabajador/a independiente", "Profesionista independiente",
                "Campesino/a o trabajador/a del campo", "Obrero/a",
                "Jubilado/a o pensionado/a", "Desempleado/a", "Otra",
                "Prefiere no decir",
            ],
        },
        {
            "key": "education", "label": "Escolaridad", "type": "single",
            "enabled": True, "required": False,
            "options": [
                "Sin estudios", "Primaria", "Secundaria",
                "Preparatoria / bachillerato", "Carrera técnica",
                "Licenciatura", "Posgrado", "Prefiere no decir",
            ],
        },
        {
            "key": "municipality", "label": "Municipio", "type": "text",
            "enabled": True, "required": True, "options": [],
        },
        {
            "key": "district", "label": "Distrito", "type": "text",
            "enabled": True, "required": False, "options": [],
            "help": "Distrito local, federal o clave interna del estudio.",
        },
        {
            "key": "electoral_section", "label": "Sección electoral", "type": "number_flex",
            "enabled": True, "required": False, "options": [],
            "help": "Preferentemente numérica; admite clave especial.",
        },
        {
            "key": "locality_zone", "label": "Localidad / colonia / zona", "type": "text",
            "enabled": True, "required": False, "options": [],
        },
    ]
}

# Etiquetas legibles para segmentación / exportación.
FIELD_LABELS = {
    "sex": "Sexo", "age_group": "Edad", "occupation": "Ocupación",
    "education": "Escolaridad", "municipality": "Municipio", "district": "Distrito",
    "electoral_section": "Sección electoral", "locality_zone": "Localidad / colonia / zona",
    "operator": "Encuestador",
}
