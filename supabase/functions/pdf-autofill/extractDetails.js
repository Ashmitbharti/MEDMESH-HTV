const labels = {
  name: 'patient name|full name',
  age: 'patient age|age',
  gender: 'gender identity|gender',
  blood: 'blood group|blood type',
  allergies: 'known allergies|allergies',
  conditions: 'medical conditions|existing conditions|conditions',
  medications: 'current medications|medications|medicines',
  contact: 'emergency contact',
};

export function extractDetails(text) {
  const details = {};
  const allLabels = Object.values(labels).join('|');

  for (const [key, label] of Object.entries(labels)) {
    const pattern = new RegExp(`(?:^|[\\r\\n]|\\s{2,})(?:${label})\\s*[:=]\\s*([^\\r\\n]+)`, 'gi');
    const values = [...text.matchAll(pattern)].map((match) => {
      return match[1].split(new RegExp(`\\s+(?:${allLabels})\\s*[:=]`, 'i'))[0].trim();
    }).filter(Boolean);
    const unique = [...new Set(values)];

    // Conflicting reports and missing labels need a manual answer.
    if (unique.length !== 1 || unique[0].length > 500) continue;

    let value = unique[0];

    if (key === 'age') {
      const age = value.match(/^(\d{1,3})(?:\s*(?:years?|yrs?|y))?$/i);
      if (!age || Number(age[1]) > 130) continue;
      value = String(Number(age[1]));
    }

    if (key === 'blood') {
      value = value.toUpperCase().replace(/\s+/g, '');
      if (!/^(A|B|AB|O)[+-]$/.test(value)) continue;
    }

    if (key === 'gender') {
      const genders = { female: 'Female', male: 'Male', 'non-binary': 'Non-binary' };
      value = genders[value.toLowerCase()] || value;
    }

    details[key] = value;
  }

  return details;
}
