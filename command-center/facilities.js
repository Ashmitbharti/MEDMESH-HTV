const emergencySource = {
  title: 'SHN emergency services',
  url: 'https://www.shn.ca/areas-of-care/emergency-and-urgent-care/',
};
const criticalCareSource = {
  title: 'SHN critical care services',
  url: 'https://www.shn.ca/areas-of-care/critical-care/',
};
const hospitalContacts = {
  title: 'SHN published site contacts (2025–26)',
  url: 'https://www.shn.ca/wp-content/uploads/Final-Copy-of-2025_26-Quality-Improvement-Plan-QIP-Narrative-part-1-signed.pdf',
};

export const referenceLocation = {
  name: 'Sam Ibrahim Building, UTSC',
  address: '1050 Military Trail, Toronto, ON',
  source: 'https://www.utsc.utoronto.ca/hwc/contact-and-location',
};

export const verifiedOn = '2026-10-17';

export const hospitalCapacity = {
  organization: 'Scarborough Health Network',
  beds: 896,
  period: 'FY 2024/2025',
  scope: 'Network-wide total; not a separate count for each hospital.',
  source: 'https://www.shn.ca/key-facts/',
  definitionSource: 'https://www.cihi.ca/en/indicators/number-of-acute-care-beds',
};

// Bundled public reference data. Live capacity and stock are not provided by these sources.
export const hospitals = [
  {
    id: 'shn-centenary',
    hosid: 'MMH-CEN',
    capacity: { beds: 307, simulated: false, period: 'Reporting year unspecified', source: 'https://en.wikipedia.org/wiki/Centenary_Hospital' },
    demoAvailability: { freeBeds: 12, freeIcuBeds: 2, erWaitMinutes: 45, open: true },
    name: 'Centenary Hospital',
    organization: 'Scarborough Health Network',
    address: '2867 Ellesmere Road, Scarborough, ON M1E 4B9',
    phone: '416-284-8131',
    services: ['Emergency department', 'Intensive care', 'Coronary care'],
    hours: 'Published emergency department hours: 24 hours, every day.',
    sources: [hospitalContacts, emergencySource, criticalCareSource],
  },
  {
    id: 'shn-general',
    hosid: 'MMH-GEN',
    capacity: { beds: 556, simulated: false, period: 'Reporting year unspecified', source: 'https://en.wikipedia.org/wiki/Scarborough_General_Hospital_(Toronto)' },
    demoAvailability: { freeBeds: 6, freeIcuBeds: 1, erWaitMinutes: 75, open: true },
    name: 'General Hospital',
    organization: 'Scarborough Health Network',
    address: '3050 Lawrence Avenue East, Scarborough, ON M1P 2V5',
    phone: '416-438-2911',
    services: ['Emergency department', 'Intensive care'],
    hours: 'Published emergency department hours: 24 hours, every day.',
    sources: [hospitalContacts, emergencySource, criticalCareSource],
  },
  {
    id: 'shn-birchmount',
    hosid: 'MMH-BIR',
    capacity: { beds: 250, simulated: true, period: 'Demo assumption' },
    demoAvailability: { freeBeds: 18, freeIcuBeds: 3, erWaitMinutes: 30, open: true },
    name: 'Birchmount Hospital',
    organization: 'Scarborough Health Network',
    address: '3030 Birchmount Road, Scarborough, ON M1W 3W3',
    phone: '416-495-2400',
    services: ['Emergency department', 'Intensive care'],
    hours: 'Published emergency department hours: 24 hours, every day.',
    sources: [hospitalContacts, emergencySource, criticalCareSource],
  },
];

export const pharmacies = [
  {
    id: 'care-ida-ellesmere',
    name: 'Care IDA Pharmacy',
    organization: 'Ellesmere Road',
    address: '3600 Ellesmere Road, Unit 2, Scarborough, ON M1C 4Y8',
    phone: '416-287-6674',
    services: ['General pharmacy', 'Blister packaging', 'Medication reviews'],
    hours: 'Listed hours: Mon–Thu 9am–7pm; Fri 9am–6pm; Sat 10am–3pm. Sunday not listed.',
    sourceUpdated: '2025-09-24',
    sources: [{ title: 'Ontario Health atHome service directory', url: 'https://lignesantecentre-est.ca/displayService.aspx?id=150258' }],
  },
  {
    id: 'food-basics-ellesmere',
    name: 'Food Basics Pharmacy',
    organization: 'Ellesmere Road',
    address: '2900 Ellesmere Road, Scarborough, ON M1E 4B8',
    phone: '416-281-0505',
    services: ['Pharmacy'],
    hours: 'Published pharmacy hours: Mon–Fri 9am–9pm; Sat 9am–6pm; Sun 10am–5pm.',
    sources: [{ title: 'Food Basics official location', url: 'https://www.foodbasics.ca/en/find-a-grocery/100863' }],
  },
  {
    id: 'highland-creek-drugs',
    name: 'Highland Creek Drugs',
    organization: 'Old Kingston Road',
    address: '371 Old Kingston Road, Toronto, ON M1C 1B6',
    phone: '416-286-6522',
    services: ['General pharmacy', 'Prescription delivery', 'Blister packaging', 'Medication reviews'],
    hours: 'Listed hours: Mon–Fri 9am–7pm; Sat–Sun 10am–3pm.',
    sourceUpdated: '2025-09-24',
    sources: [{ title: 'Ontario Health atHome service directory', url: 'https://www.centraleasthealthline.ca/displayservice.aspx?id=150690' }],
  },
];
