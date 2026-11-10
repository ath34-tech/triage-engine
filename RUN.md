# Run the submission

From this directory, run:

```sh
python engine.py
python -m http.server 8000 --directory dist
```

Open http://localhost:8000. The console loads the checked-in snapshot from `dist/cases.json`.
Its decisions and audit history persist in the current browser. Approving a patch records
the decision and replacement in that history. It does not write to Acadza or send a student
message. Publish the contents of `dist/` on a static host to share the demo.

## Engine modes

- `python engine.py` rebuilds the snapshot using dataset-specific evidence authored during development.
- `python engine.py --live` calls a Chat Completions-compatible JSON-mode provider.
  Set `LLM_BASE_URL` (including the provider's API version path), `LLM_MODEL`, and
  `LLM_API_KEY` in your environment. The solver sees just the question and type, and its
  result is reused across reports for that question. Triage compares it with the stored key
  and solution. A malformed response or failed request aborts before results are written.

Both paths run the same repair-scope and exact-match checks. The demo routes every defect
to faculty, including repairs eligible for future automatic application. An unsupported
edit is dropped and the case remains reviewable. Moving a record between question types
requires migrating its nested payload, so that case has no automated patch.

The queue prioritizes open defects, then broken stems/options, missing diagrams, and
grading-impacting repairs, with report count as a signal of reach within each tier.
