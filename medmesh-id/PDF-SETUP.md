# PDF autofill setup

1. Create a Supabase project.
2. In Authentication settings, enable anonymous sign-ins. The PDF function requires a valid user session.
3. Copy `.env.example` to `.env`. Fill in the project URL and publishable key from Supabase's Connect dialog. Never put a service role or secret key in the app.
4. Deploy the included function from the repository root:

```cmd
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy pdf-autofill
```

5. Restart Expo so it loads the environment variables.

The upload button selects one PDF (up to 5 MB and 20 pages), explains that it will be sent to Supabase, and asks the user to confirm before uploading. Extracted answers are editable suggestions. Applying them fills only unanswered fields and leaves all other answers unchanged.

The function reads text PDFs in memory and does not store reports or extracted details. It recognizes explicit colon/equal-separated labels: Patient name/Full name, Age, Gender/Gender identity, Blood group/Blood type, Allergies, Conditions, Medications, and Emergency contact. Missing or conflicting values are left blank. It does not infer diagnoses from test results, derive gender from sex, or read scanned images. Such reports require manual entry or a future OCR integration.

Manual form entry and saved Medical IDs work offline. Supabase sessions and the profile copy persist on this device. A first registration needs internet to assign a unique six-letter ID. If syncing fails, the local copy is marked pending; use Retry sync after reconnecting. Updates retain the registered ID. The command centre backup and LoRa transmission are separate chunks.

For profile saving, run `supabase/migrations/20261017000000_medical_profiles.sql` in the Supabase SQL Editor. This extends an existing medical_profiles table or creates it when missing. It adds unique IDs and owner-only access. The app does not deploy or run the migration automatically.
