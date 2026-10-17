"""Seed data for the MedMesh demo.

Everything here is SIMULATED demo data:
- Hospital and pharmacy names, addresses and total beds come from public sources gathered by Ashmit
  (SHN key facts, Ontario Health atHome directory; see app dashboard/sites.js). Map positions are approximate.
  Free beds, ICU, waits, stock, prices and open/closed status are SIMULATED. Places marked (demo) are fictional.
- Pharmacies, patients and the EMS post are fictional.
- The road network is a simplified grid of real Scarborough arterial roads.
  Run prepare_map.py (needs internet once) to replace it with real OSM roads.
"""

HOSPITALS = [
    # id, name, lat, lon, total beds, free beds, icu free, capabilities
    # caps: C=cardiac T=trauma B=burns O=obstetrics P=paediatrics D=dialysis
    # er_spaces (ED treatment spaces), svc_min (mean ED treatment time) and er_wait feed the queueing model.
    # DEMO VALUES: replace with official figures (CIHI beds, Ontario Health ED times) when loaded.
    {"id": "SGH", "name": "SHN General Hospital", "lat": 43.7556, "lon": -79.2462,
     "total": 556, "free": 4, "icu": 1, "caps": "CTD", "open": True, "er_wait": 95,
     "kind": "hospital", "er_spaces": 10, "svc_min": 50},
    {"id": "CEN", "name": "Centenary Hospital", "lat": 43.7783, "lon": -79.2053,
     "total": 307, "free": 6, "icu": 2, "caps": "CTOPD", "open": True, "er_wait": 70,
     "kind": "hospital", "er_spaces": 8, "svc_min": 45},
    {"id": "BIR", "name": "Birchmount Hospital", "lat": 43.8016, "lon": -79.3046,
     "total": 250, "free": 3, "icu": 0, "caps": "T", "open": True, "er_wait": 60,
     "kind": "hospital", "er_spaces": 6, "svc_min": 45},
    {"id": "UFC", "name": "UTSC Field Clinic (demo)", "lat": 43.7839, "lon": -79.1874,
     "total": 10, "free": 8, "icu": 0, "caps": "", "open": True, "er_wait": 15,
     "kind": "clinic", "er_spaces": 4, "svc_min": 20},
]

PHARMACIES = [
    {"id": "MSP", "name": "Care IDA Pharmacy", "lat": 43.7868, "lon": -79.1745, "open": True, "kind": "pharmacy",
     "stock": {"INSULIN": 12, "INHALER": 20, "EPIPEN": 4, "HEART": 30, "SEIZURE": 8, "BP": 40, "ONEG": 0,
               "STRIPS": 15, "DRESS": 30, "NEB": 2}},
    {"id": "ECP", "name": "Ellesmere Community Rx (demo)", "lat": 43.7765, "lon": -79.2430, "open": True, "kind": "pharmacy",
     "stock": {"INSULIN": 5, "INHALER": 6, "EPIPEN": 10, "HEART": 12, "SEIZURE": 2, "BP": 15, "ONEG": 0,
               "STRIPS": 6, "DRESS": 12, "NEB": 0}},
    {"id": "MVR", "name": "Highland Creek Drugs", "lat": 43.7853, "lon": -79.1717, "open": False, "kind": "pharmacy",
     "stock": {"INSULIN": 20, "INHALER": 15, "EPIPEN": 6, "HEART": 25, "SEIZURE": 10, "BP": 30, "ONEG": 0,
               "STRIPS": 10, "DRESS": 20, "NEB": 1}},
    # Home oxygen in Ontario comes from home-oxygen suppliers, not drugstores (demo supplier, not a real company)
    {"id": "SHO", "name": "Scarborough Home Oxygen (demo)", "lat": 43.7712, "lon": -79.2300, "open": True, "kind": "supplier",
     "stock": {"O2": 4, "CPAPPWR": 3, "NEB": 3}},
]

# Normal (pre-disaster) unit prices in CAD and each place's current emergency price. DEMO VALUES, not real prices.
# During an emergency the command centre caps prices at normal + PRICE_CAP_PCT (default 10%).
BASE_PRICES = {"INSULIN": 40.0, "INHALER": 30.0, "EPIPEN": 120.0, "HEART": 25.0, "SEIZURE": 35.0, "BP": 18.0, "ONEG": 0.0,
               "STRIPS": 45.0, "DRESS": 8.0, "NEB": 90.0, "O2": 60.0, "CPAPPWR": 150.0}
EMERGENCY_PRICES = {
    "MSP": {"INSULIN": 41.0, "INHALER": 31.0, "EPIPEN": 125.0, "HEART": 25.0, "SEIZURE": 36.0, "BP": 18.0, "STRIPS": 46.0, "DRESS": 8.5, "NEB": 92.0},
    "ECP": {"INSULIN": 64.0, "INHALER": 29.0, "EPIPEN": 199.0, "HEART": 26.0, "SEIZURE": 35.0, "BP": 19.0, "STRIPS": 70.0, "DRESS": 8.0},
    "MVR": {"INSULIN": 40.0, "INHALER": 30.0, "EPIPEN": 120.0, "HEART": 25.0, "SEIZURE": 35.0, "BP": 18.0, "STRIPS": 45.0, "DRESS": 8.0, "NEB": 90.0},
    "SHO": {"O2": 63.0, "CPAPPWR": 240.0, "NEB": 95.0},
}

EMS_POST = {"id": "EMS", "name": "EMS Post 1", "lat": 43.7790, "lon": -79.2260}

MED_NAMES = {"INSULIN": "Insulin", "INHALER": "Inhaler", "EPIPEN": "EpiPen", "HEART": "Heart medication",
             "SEIZURE": "Seizure medication", "BP": "Blood-pressure medication", "ONEG": "O-neg blood",
             "OTHER": "Other medication", "O2": "Oxygen cylinder / refill", "CPAPPWR": "Power for CPAP / oxygen machine",
             "STRIPS": "Diabetic test strips & needles", "DRESS": "Wound dressings", "NEB": "Nebuliser"}

# Fake opt-in medical profiles, keyed by MedMesh ID (synthetic, not real people)
PROFILES = {
    "MX4K9P": {"name": "Arun Mehta", "age": 61, "sex": "M", "blood": "O-", "allergies": ["Penicillin"],
               "conditions": ["Type 2 diabetes", "Atrial fibrillation"], "meds": ["Warfarin", "Metformin"],
               "contact": "Priya Mehta (daughter)", "updated": "2026-08-30"},
    "QL7T2D": {"name": "Grace Okafor", "age": 34, "sex": "F", "blood": "A+", "allergies": ["Latex"],
               "conditions": ["Pregnant (32 weeks)"], "meds": ["Prenatal vitamins"],
               "contact": "Daniel Okafor (partner)", "updated": "2026-09-21"},
    "HV3N8R": {"name": "Liam Chen", "age": 8, "sex": "M", "blood": "B+", "allergies": ["Peanuts"],
               "conditions": ["Asthma"], "meds": ["Salbutamol inhaler", "EpiPen"],
               "contact": "Mei Chen (mother)", "updated": "2026-07-02"},
    "ZP5W1K": {"name": "Margaret Doyle", "age": 79, "sex": "F", "blood": "AB-", "allergies": [],
               "conditions": ["Heart failure", "Chronic kidney disease"], "meds": ["Furosemide", "Bisoprolol"],
               "contact": "Sean Doyle (son)", "updated": "2026-06-14"},
    "TB8C6M": {"name": "Omar Haddad", "age": 45, "sex": "M", "blood": "O+", "allergies": ["Sulfa drugs"],
               "conditions": ["Epilepsy"], "meds": ["Levetiracetam"],
               "contact": "Leila Haddad (wife)", "updated": "2026-09-02"},
}

# Simplified road grid (real road names, approximate positions)
EW_ROADS = [  # name, lat, speed km/h
    ("Finch Ave E", 43.8100, 50),
    ("Sheppard Ave E", 43.7970, 50),
    ("Hwy 401", 43.7880, 90),
    ("Ellesmere Rd", 43.7765, 50),
    ("Lawrence Ave E", 43.7630, 50),
    ("Eglinton Ave E", 43.7470, 50),
]
NS_ROADS = [  # name, lon, speed, (lat_min, lat_max) extent
    ("Birchmount Rd", -79.3005, 50, None),
    ("Kennedy Rd", -79.2840, 50, None),
    ("Midland Ave", -79.2690, 50, None),
    ("Brimley Rd", -79.2560, 50, None),
    ("McCowan Rd", -79.2462, 50, None),
    ("Markham Rd", -79.2260, 50, None),
    ("Morningside Ave", -79.2053, 50, None),
    ("Military Trail", -79.1874, 40, (43.7765, 43.7970)),
    ("Meadowvale Rd", -79.1700, 50, None),
]

# Default demo positions for the four boards (shown on the dashboard network view)
NODE_LAYOUT = {
    "FIELD": (43.7680, -79.1900),
    "RELAY": (43.7950, -79.2150),
    "RESP": (43.7540, -79.2250),
    "BASE": (43.7850, -79.2620),
    "HOSP": (43.7600, -79.2550),   # simulator-only phones
    "PHARM": (43.7980, -79.2450),
}
