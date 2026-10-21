import { describe, it, expect } from 'vitest';
import { findDuplicateFarmer, registrationSuggestions, projectsAlongRoute } from '../farmerRegistrationChecks';

const registry = [
  { id: 1, firstName: 'Juan', lastName: 'Dela Cruz', extName: '', birthday: '1980-05-01', barangay: 'Tabuc', municipality: 'Leon', contactNumber: '09171234567' },
  { id: 2, firstName: 'Maria', lastName: 'Santos', extName: '', birthday: '', barangay: 'Bucari', municipality: 'Leon', contactNumber: '' },
];

describe('findDuplicateFarmer', () => {
  it('catches the same name and birthday, ignoring case and punctuation', () => {
    expect(findDuplicateFarmer({ firstName: 'JUAN', lastName: 'dela cruz', birthday: '1980-05-01' }, registry))
      .toMatchObject({ reason: 'name_birthday', row: { id: 1 } });
  });

  it('allows a different person with the same name (different birthday or suffix)', () => {
    expect(findDuplicateFarmer({ firstName: 'Juan', lastName: 'Dela Cruz', birthday: '1999-01-01' }, registry)).toBeNull();
    expect(findDuplicateFarmer({ firstName: 'Juan', lastName: 'Dela Cruz', extName: 'Jr.', birthday: '1980-05-01' }, [{ ...registry[0], extName: 'Sr.' }])).toBeNull();
  });

  it('uses the barangay when a birthday is missing, and catches a reused contact number', () => {
    expect(findDuplicateFarmer({ firstName: 'Maria', lastName: 'Santos', barangay: 'Bucari', municipality: 'Leon' }, registry))
      .toMatchObject({ reason: 'name_barangay' });
    expect(findDuplicateFarmer({ firstName: 'Pedro', lastName: 'Reyes', contactNumber: '+63 917 123 4567' }, registry))
      .toMatchObject({ reason: 'contact' });
  });

  it('ignores the farmer being edited', () => {
    expect(findDuplicateFarmer({ firstName: 'Juan', lastName: 'Dela Cruz', birthday: '1980-05-01' }, registry, 1)).toBeNull();
  });
});

describe('registrationSuggestions', () => {
  it('suggests fixes without blocking', () => {
    const tips = registrationSuggestions({ form: { contactNumber: '', birthday: '', farmAreaHa: '0.01' }, linkedProjectId: '' });
    expect(tips.join(' ')).toMatch(/contact number/);
    expect(tips.join(' ')).toMatch(/birthday/);
    expect(tips.join(' ')).toMatch(/square meters/);
    expect(tips.join(' ')).toMatch(/No FMR road/);
  });
});

describe('projectsAlongRoute', () => {
  // A route heading east along lat 10.800, ~2.2 km long.
  const route = Array.from({ length: 21 }, (_, i) => [10.8, 122.4 + i * 0.001]);
  it('finds the FMR roads the route runs along, in order', () => {
    const projects = [
      { id: 'B', name: 'Second road', line: [[10.8, 122.412], [10.8, 122.42]] },
      { id: 'A', name: 'First road', line: [[10.8, 122.4], [10.8, 122.406]] },
      { id: 'X', name: 'Crossing road', line: [[10.79, 122.41], [10.81, 122.41]] }, // only crosses it
    ];
    expect(projectsAlongRoute(route, projects).map((p) => p.id)).toEqual(['A', 'B']);
  });
});
