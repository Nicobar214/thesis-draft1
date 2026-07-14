import { getBarangays, getMunicipalities } from '../data/iloiloLocations';

export const BENEFICIARY_CROPS = ['Rice', 'Corn', 'Sugarcane', 'Coconut', 'Vegetables', 'Banana'];

export const BENEFICIARY_VALIDATION_STATUSES = [
  'For Verification',
  'Validated',
  'Needs Correction',
  'Duplicate Record',
  'Rejected',
  'Archived',
];

export const BENEFICIARY_STATUS_OPTIONS = ['Active Beneficiary', 'Under Review', 'Inactive'];

export const LGU_SUBMITTERS = [
  'Leon Municipal Agriculture Office',
  'Barotac Nuevo LGU Agriculture Office',
  'Passi City Agriculture Office',
  'Janiuay Municipal Agriculture Office',
  'Dumangas Municipal Agriculture Office',
  'Santa Barbara Agriculture Office',
  'Pototan Municipal Agriculture Office',
  'Cabatuan Municipal Agriculture Office',
];

const FIRST_NAMES = [
  'Mark', 'Paolo', 'Joshua', 'Miguel', 'Angelo', 'Bryan', 'Noel', 'Ramon', 'Jose', 'Carlo',
  'Maria', 'Angela', 'Rosa', 'Liza', 'Catherine', 'Leah', 'Joy', 'Irene', 'Grace', 'Ana',
];

const LAST_NAMES = [
  'Cruz', 'Garcia', 'Reyes', 'Santos', 'Torres', 'Flores', 'Ramos', 'Mendoza', 'Gonzales',
  'Bautista', 'Delos Santos', 'Castillo', 'Rivera', 'Navarro', 'Domingo', 'Villanueva',
  'Pascual', 'Dela Cruz', 'Salazar', 'Valdez',
];

const FALLBACK_PROJECTS = [
  'Iloilo North Farm-to-Market Road Package',
  'Barotac Nuevo Access Road Upgrade',
  'Central Iloilo Produce Corridor',
  'Passi Agro-Logistics Connector',
  'Western Iloilo Link Road',
  'Janiuay Mountain Barangay Connector',
];

const seededRandom = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const pickFrom = (list, seed) => list[Math.floor(seededRandom(seed) * list.length) % list.length];

const makePhoneNumber = (seed) => {
  const digits = Array.from({ length: 9 }, (_, idx) => Math.floor(seededRandom(seed + idx + 3) * 10));
  return `09${digits.join('')}`;
};

const cropYieldPerHectare = (crop) => {
  if (crop === 'Rice') return 4.2;
  if (crop === 'Corn') return 3.6;
  if (crop === 'Sugarcane') return 65;
  if (crop === 'Coconut') return 8;
  if (crop === 'Vegetables') return 12;
  return 9;
};

export function buildFarmerBeneficiaries(fmrProjects, size = 84) {
  const projectPool = (fmrProjects || [])
    .map((project) => ({
      id: project.id,
      name: project.project_name || project.projectName || 'Unnamed FMR Project',
      municipality: project.municipality || 'Leon',
      status: project.status || project.project_status || 'On-Going',
    }))
    .filter((project) => project.name);

  const projects = projectPool.length
    ? projectPool
    : FALLBACK_PROJECTS.map((name, idx) => ({
      id: `fallback-${idx + 1}`,
      name,
      municipality: pickFrom(getMunicipalities(), idx + 11),
      status: idx % 3 === 0 ? 'Completed' : idx % 2 === 0 ? 'Proposed' : 'On-Going',
    }));

  return Array.from({ length: size }, (_, idx) => {
    const seed = (idx + 3) * 37;
    const project = projects[idx % projects.length];
    const firstName = pickFrom(FIRST_NAMES, seed + 1);
    const lastName = pickFrom(LAST_NAMES, seed + 7);
    const municipality = project.municipality || pickFrom(getMunicipalities(), seed + 11);
    const barangays = getBarangays(municipality);
    const barangay = barangays.length ? pickFrom(barangays, seed + 13) : 'Poblacion';
    const crop = pickFrom(BENEFICIARY_CROPS, seed + 17);
    const farmAreaHa = Number((seededRandom(seed + 19) * 8 + 0.8).toFixed(2));
    const estimatedYield = Number((farmAreaHa * cropYieldPerHectare(crop)).toFixed(1));
    const submittedYear = 2021 + Math.floor(seededRandom(seed + 31) * 5);
    const submittedDate = new Date(submittedYear, Math.floor(seededRandom(seed + 41) * 12), 1 + Math.floor(seededRandom(seed + 43) * 27));
    const validationStatus = pickFrom(BENEFICIARY_VALIDATION_STATUSES, seed + 47);
    const beneficiaryStatus = validationStatus === 'Archived' ? 'Inactive' : validationStatus === 'Validated' ? 'Active Beneficiary' : 'Under Review';
    const submittedByLgu = pickFrom(LGU_SUBMITTERS, seed + 53);
    const distanceToFmrKm = Number((seededRandom(seed + 59) * 2.8 + 0.15).toFixed(2));
    const serviceArea = distanceToFmrKm <= 1 ? 'Within primary service area' : distanceToFmrKm <= 2 ? 'Within secondary service area' : 'For proximity verification';
    const gpsLat = 10.6 + seededRandom(seed + 61) * 0.8;
    const gpsLng = 122.2 + seededRandom(seed + 67) * 0.8;

    return {
      id: `BEN-${String(idx + 1).padStart(5, '0')}`,
      beneficiaryId: `BEN-${String(idx + 1).padStart(5, '0')}`,
      fullName: `${firstName} ${lastName}`,
      rsbsaNumber: `RSBSA-06-${String(100000 + idx * 37).padStart(6, '0')}`,
      contactNumber: makePhoneNumber(seed + 79),
      municipality,
      barangay,
      crop,
      farmAreaHa,
      estimatedYield,
      linkedProjectId: project.id,
      linkedProject: project.name,
      linkedProjects: [project.name],
      linkedProjectStatus: project.status,
      distanceToFmrKm,
      serviceArea,
      benefitReason: `${serviceArea}; farm access depends on the linked FMR route for hauling ${crop.toLowerCase()} production.`,
      beneficiaryStatus,
      validationStatus,
      submittedDate,
      submittedByLgu,
      lastUpdated: new Date(submittedDate.getTime() + 1000 * 60 * 60 * 24 * (12 + Math.floor(seededRandom(seed + 83) * 120))),
      adminRemarks: validationStatus === 'Validated'
        ? 'Validated against LGU submission and linked project service area.'
        : validationStatus === 'Needs Correction'
          ? 'Correction required: update farm area proof or registry reference.'
          : validationStatus === 'Duplicate Record'
            ? 'Possible duplicate record found under the same barangay and registry number.'
            : validationStatus === 'Rejected'
              ? 'Record does not currently meet beneficiary registry requirements.'
              : 'Awaiting DA review and supporting validation.',
      supportingDocuments: ['LGU endorsement', 'Farm location sketch', 'Barangay certification'],
      gps: { lat: gpsLat, lng: gpsLng },
      validationHistory: [
        {
          date: submittedDate,
          actor: submittedByLgu,
          action: 'Submitted beneficiary record',
          remarks: 'LGU submitted farmer beneficiary for DA validation.',
        },
        {
          date: new Date(submittedDate.getTime() + 1000 * 60 * 60 * 24 * 7),
          actor: 'DA Regional Admin',
          action: validationStatus,
          remarks: validationStatus === 'For Verification' ? 'Queued for DA validation.' : 'Initial DA review completed.',
        },
      ],
    };
  });
}
