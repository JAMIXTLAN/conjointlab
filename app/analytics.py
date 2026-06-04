"""Generación de escenarios y cálculos de preferencia."""
import random
from typing import List, Dict
from . import models


def total_possible(attributes) -> int:
    total = 1
    for a in attributes:
        total *= max(len(a.categories), 1)
    return total


def generate_tasks(study) -> List[dict]:
    """Genera las pantallas (tareas) para un nuevo encuestado.

    - Una categoría por atributo en cada opción.
    - Sin opciones duplicadas dentro de una misma pantalla.
    - Intenta no repetir combinaciones a lo largo de la entrevista
      mientras el universo de combinaciones lo permita.
    """
    attrs = study.attributes
    possible = total_possible(attrs)
    seen_global = set()
    tasks = []

    for t in range(study.tasks_per_respondent):
        task_seen = set()
        options = []
        guard = 0
        while len(options) < study.options_per_task and guard < 4000:
            guard += 1
            picks = [random.randrange(len(a.categories)) for a in attrs]
            key = "-".join(map(str, picks))
            if key in task_seen:
                continue
            if key in seen_global and len(seen_global) < possible and guard < 2500:
                continue
            task_seen.add(key)
            seen_global.add(key)
            options.append({
                "option_index": len(options),
                "items": [
                    {
                        "attribute_id": attrs[ai].id,
                        "attribute_name": attrs[ai].name,
                        "category_id": attrs[ai].categories[ci].id,
                        "category_name": attrs[ai].categories[ci].name,
                    }
                    for ai, ci in enumerate(picks)
                ],
            })
        tasks.append({"task_index": t, "options": options})
    return tasks


def compute_results(study, respondents) -> dict:
    """Calcula porcentajes por categoría, por combinación y rankings."""
    # estructura de categorías
    cat_stats: Dict[str, dict] = {}
    for a in study.attributes:
        for c in a.categories:
            cat_stats[c.id] = {
                "attribute_id": a.id, "attribute_name": a.name,
                "category_id": c.id, "category_name": c.name,
                "shown": 0, "chosen": 0,
            }
    combo_stats: Dict[str, dict] = {}
    total_choices = 0
    n_responses = 0
    op_stats: Dict[str, dict] = {}  # operador -> conteos

    for r in respondents:
        answered = any(i.chosen_option_index is not None for i in r.interactions)
        if answered:
            n_responses += 1
            op = (r.operator or "(sin operador)")
            if op not in op_stats:
                op_stats[op] = {"operator": op, "respondents": 0, "choices": 0}
            op_stats[op]["respondents"] += 1
            op_stats[op]["choices"] += sum(
                1 for i in r.interactions if i.chosen_option_index is not None
            )
        for inter in r.interactions:
            if inter.chosen_option_index is None:
                continue
            total_choices += 1
            for opt in inter.options:
                key = "|".join(
                    f"{it.attribute_id}={it.category_id}"
                    for it in sorted(opt.items, key=lambda x: x.attribute_id)
                )
                if key not in combo_stats:
                    combo_stats[key] = {
                        "label": " · ".join(it.category_name for it in opt.items),
                        "parts": [
                            {"attribute_name": it.attribute_name, "category_name": it.category_name}
                            for it in opt.items
                        ],
                        "shown": 0, "chosen": 0,
                    }
                combo_stats[key]["shown"] += 1
                for it in opt.items:
                    if it.category_id in cat_stats:
                        cat_stats[it.category_id]["shown"] += 1
                is_chosen = opt.option_index == inter.chosen_option_index
                if is_chosen:
                    combo_stats[key]["chosen"] += 1
                    for it in opt.items:
                        if it.category_id in cat_stats:
                            cat_stats[it.category_id]["chosen"] += 1

    def share(chosen):
        return chosen / total_choices if total_choices else 0.0

    def win(chosen, shown):
        return chosen / shown if shown else 0.0

    # por atributo (el % suma 100% dentro de cada atributo)
    by_attribute = []
    for a in study.attributes:
        cats = []
        for c in a.categories:
            s = cat_stats[c.id]
            cats.append({
                "category_id": c.id, "category_name": c.name,
                "shown": s["shown"], "chosen": s["chosen"],
                "share": share(s["chosen"]), "win_rate": win(s["chosen"], s["shown"]),
            })
        cats.sort(key=lambda x: -x["chosen"])
        by_attribute.append({"attribute_id": a.id, "attribute_name": a.name, "categories": cats})

    # ranking global de categorías por tasa de preferencia
    all_cats = sorted(
        ({
            "attribute_name": v["attribute_name"], "category_name": v["category_name"],
            "shown": v["shown"], "chosen": v["chosen"],
            "share": share(v["chosen"]), "win_rate": win(v["chosen"], v["shown"]),
        } for v in cat_stats.values()),
        key=lambda x: -x["win_rate"],
    )

    combos = sorted(
        ({
            "label": v["label"], "parts": v["parts"],
            "shown": v["shown"], "chosen": v["chosen"],
            "share": share(v["chosen"]), "win_rate": win(v["chosen"], v["shown"]),
        } for v in combo_stats.values()),
        key=lambda x: (-x["chosen"], -x["win_rate"]),
    )

    return {
        "study_id": study.id, "study_name": study.name,
        "n_responses": n_responses, "total_choices": total_choices,
        "attribute_count": len(study.attributes),
        "by_attribute": by_attribute, "all_categories": all_cats, "combos": combos,
        "by_operator": sorted(op_stats.values(), key=lambda x: -x["respondents"]),
    }
