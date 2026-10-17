# pdf-autofill: read a medical report with Gemini

The app sends a PDF or a photo of a report. This function returns proposed facts. The app compares them with
the saved profile and the person accepts or rejects each change. Nothing is saved automatically, and the
report is never stored.

## Setup (5 minutes)

1. Get a key at https://aistudio.google.com/apikey
2. Run these commands:

```bash
supabase secrets set GEMINI_API_KEY=your-key
# optional, the default is gemini-3.8-flash
supabase secrets set GEMINI_MODEL=gemini-3.8-flash
supabase functions deploy pdf-autofill
```

Without a key, the function falls back to the original text rules. These work only for text PDFs, not photos.

## How it works

| Step | Where | What |
|---|---|---|
| 1. Extract | Gemini (`gemini.js`) | The response is constrained by a JSON schema: allergies, conditions (active/resolved/suspected), medications (dose, frequency, stopped), lab results (value, range, flag), devices. **Every item must include a verbatim quote from the document.** |
| 2. Validate | `normalise()` | Drops items without a quote, removes duplicates, checks enums, validates blood group and age (0–130), and strips "no known allergies". |
| 3. Compare | app `reportDiff.js` | Deterministic: new items, changed doses, items the report says are stopped or resolved, and flagged labs. |
| 4. Decide | app review screen | The person ticks each change. Removals and "suspected" items start unticked. |

To preview the review screen without a key, open the web build with `?demo=report`.
