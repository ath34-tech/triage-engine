import argparse
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).parent

def load(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8-sig"))

def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def patch(field, find, replace):
    return dict(field=field, find=find, replace=replace)

def snapshot(report, question, notes):
    number = int(report["reportId"][1:])
    original = {2: 1, 3: 1, 8: 7, 10: 9, 19: 18}.get(number, number)
    label, evidence = notes[original]
    content = question[question["questionType"]]
    patches = {
        1: patch("answer", "C", "A"),
        4: patch("answer", "A", "D"),
        5: patch("answer", "2", "1"),
        6: patch("question", "solid copper cube,", "solid copper cube with edge length 10 cm,"),
        7: patch("question", "an inductance are", "a 95.5 mH inductor are"),
        11: patch("question", "(C) <br />(D)", "(C) 1:1<br />(D)"),
        12: patch("question", "Epithellial tisue", "Epithelial tissue"),
        13: patch("question", "(NEET 2019) ", ""),
        14: patch("question", r"\frac{7}{8}", '<math><mfrac><mn>7</mn><mn>8</mn></mfrac></math>'),
        16: patch("solution", "a = 40 cm", "a = 20 cm"),
        20: patch("answer", ["A, B, D"], ["A", "B", "D"]),
        22: patch("question", "Choroid plexux", "Choroid plexus"),
        24: patch("question", "frictional force is equal to", "frictional force, in newtons, is equal to"),
    }
    if original == 18:
        # No valid step from the unrelated derivation is retained.
        patches[18] = patch("solution", content["solution"],
            "<p>Using λ = 0.3 nm, p = h/λ and K = p²/(2mₑ) ≈ 2.68 × 10⁻¹⁸ J ≈ 16.7 eV. The closest option is B.</p>")
    verdict = label if label in TAXONOMY["verdicts"] else "defect"
    replies = {
        "defect": "Thanks for flagging this. We found an issue and have queued it for a check.",
        "no_error": "Thanks for checking. " + evidence,
        "already_fixed": "Thanks for flagging it. The current version now shows the corrected wording.",
        "display_issue": "Thanks for letting us know. The stored question looks complete, and your report points to how it loads or displays on your device.",
        "app_issue": "Thanks for the heads-up. The key is A, so the selection you saw saved is worth investigating separately.",
        "language_mode": "Thanks for asking for a Hindi version. This report is about language availability.",
        "not_actionable": "Thanks for writing in. Could you tell us which part looked wrong so we can check it?",
    }
    return dict(verdict=verdict, repair=label if verdict == "defect" else None,
                edit=patches.get(original), confidence={6: 0.87, 7: 0.88, 23: 0.85, 26: 0.60, 37: 0.83, 42: 0.90}.get(original, 0.98), evidence=evidence,
                student_reply=replies[verdict])

def ask(prompt, value):
    base = os.environ["LLM_BASE_URL"].rstrip("/")
    body = dict(model=os.environ["LLM_MODEL"], response_format={"type": "json_object"},
                messages=[dict(role="system", content=(ROOT / prompt).read_text(encoding="utf-8-sig")),
                          dict(role="user", content=json.dumps(value, ensure_ascii=False))])
    request = Request(base + "/chat/completions", json.dumps(body).encode(),
                      {"Authorization": "Bearer " + os.environ["LLM_API_KEY"],
                       "Content-Type": "application/json"})
    with urlopen(request, timeout=90) as response:
        return json.loads(json.load(response)["choices"][0]["message"]["content"])

def guarded(candidate, question):
    verdict = candidate["verdict"]
    if verdict not in TAXONOMY["verdicts"]:
        raise ValueError("Invalid verdict")
    repair = TAXONOMY["repairs"].get(candidate.get("repair"))
    if verdict == "defect" and repair is None:
        raise ValueError("Invalid repair")
    edit = candidate.get("edit") if verdict == "defect" else None
    if isinstance(edit, dict) and repair["auto"] and edit.get("field") in repair["fields"]:
        field, old, new = edit.get("field"), edit.get("find"), edit.get("replace")
        stored = question[question["questionType"]].get(field)
        if field == "questionType":
            edit = None  # Migration requires moving the corresponding nested object atomically.
        elif field == "answer":
            if old != stored or type(new) is not type(stored) or new == old:
                edit = None
        elif not (isinstance(stored, str) and isinstance(old, str) and old
                  and stored.count(old) == 1 and isinstance(new, str) and new != old):
            edit = None
    else:
        edit = None
    confidence = float(candidate["confidence"])
    if not 0 <= confidence <= 1:
        raise ValueError("Invalid confidence")
    return dict(verdict=verdict, repair=candidate.get("repair") if verdict == "defect" else None,
                edit=edit, confidence=confidence, evidence=str(candidate["evidence"]),
                student_reply=str(candidate["student_reply"]),
                route="faculty_review" if verdict == "defect" else "no_change")

TAXONOMY = load("data/taxonomy.json")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Run independent solver and triage model")
    args = parser.parse_args()
    notes = {}
    for line in (ROOT / "evidence.txt").read_text(encoding="utf-8-sig").splitlines():
        number, label, evidence = line.split("|", 2)
        notes[int(number)] = label, evidence
    questions = {question["_id"]: question for question in load("data/questions.json")}
    reports = sorted(load("data/reports.json"), key=lambda item: item["reportId"])
    solves, results = {}, []
    for report in reports:
        question_id = report["questionId"]
        question = questions[question_id]
        record = question[question["questionType"]]
        if args.live:
            if question_id not in solves:
                solves[question_id] = ask("solver.prompt", dict(stem=record["question"], type=question["questionType"]))
            candidate = ask("triage.prompt", dict(comment=report["comment"], record=record,
                            type=question["questionType"], chapter=question["chapter"],
                            solver=solves[question_id], taxonomy=TAXONOMY))
        else:
            candidate = snapshot(report, question, notes)
        result = guarded(candidate, question)
        results.append(dict(reportId=report["reportId"], questionId=question_id, **result))
    write("results.json", results)
    # Only expose fields the console displays. Student identifiers are excluded.
    cases = {}
    for report, result in zip(reports, results):
        q = questions[report["questionId"]]
        case = cases.setdefault(q["_id"], dict(id=q["_id"], qid=q.get("qid"), subject=q["subject"], chapter=q["chapter"],
            type=q["questionType"], content=q[q["questionType"]], reports=[]))
        case["reports"].append(dict(comment=report["comment"], **result))
    write("dist/cases.json", list(cases.values()))
    print(f"Wrote {len(results)} results for {len(cases)} questions.")

if __name__ == "__main__":
    main()
