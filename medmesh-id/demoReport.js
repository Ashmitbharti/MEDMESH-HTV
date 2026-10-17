// Sample Gemini output for the review screen, used only for the web design preview (?demo=report).
// Shape matches supabase/functions/pdf-autofill/gemini.js normalise().
export const DEMO_REPORT = {
  source: 'gemini',
  model: 'demo',
  docType: 'Discharge summary',
  date: '2 Sep 2026',
  extracted: {
    document_type: 'Discharge summary', report_date: '2 Sep 2026',
    patient: { name: '', age: null, sex: '', blood_group: '' },
    allergies: [{ substance: 'Sulfa drugs', reaction: 'rash', evidence: 'ALLERGIES: Sulfonamides (rash)' }],
    conditions: [
      { name: 'Atrial fibrillation', status: 'active', evidence: 'Dx: new-onset atrial fibrillation' },
      { name: 'Asthma', status: 'resolved', evidence: 'Childhood asthma, resolved' },
    ],
    medications: [
      { name: 'Apixaban', dose: '5 mg', frequency: 'twice daily', stopped: false, evidence: 'Apixaban 5 mg PO BID (new)' },
      { name: 'Metformin', dose: '1000 mg', frequency: 'twice daily', stopped: false, evidence: 'Metformin increased to 1000 mg BID' },
    ],
    lab_results: [
      { test: 'HbA1c', value: '8.4', unit: '%', reference_range: '4.0-6.0', flag: 'high', evidence: 'HbA1c 8.4 % H (4.0-6.0)' },
    ],
    devices: [],
  },
};
