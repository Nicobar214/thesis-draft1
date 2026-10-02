export const WORK_PLAN_ACTIVITY_PRESETS = Object.freeze([
  'Earthworks',
  'Drainage',
  'Gravel',
]);

export const OTHER_ACTIVITY = 'Others';
export const OTHER_UNIT = '__other_unit__';

export const WORK_PLAN_DEFAULT_UNITS = Object.freeze({
  Earthworks: 'm\u00B3',
  Drainage: 'm',
  Gravel: 'm\u00B3',
});

export const WORK_PLAN_UNIT_OPTIONS = Object.freeze([
  { value: 'm\u00B3', label: 'm\u00B3 \u2014 Cubic meters (volume)' },
  { value: 'm\u00B2', label: 'm\u00B2 \u2014 Square meters (area)' },
  { value: 'm', label: 'm \u2014 Meters (length)' },
  { value: 'km', label: 'km \u2014 Kilometers (length)' },
  { value: 'pcs', label: 'pcs \u2014 Pieces' },
  { value: 'lot', label: 'lot \u2014 Lot' },
  { value: 'set', label: 'set \u2014 Set' },
]);

const STANDARD_UNITS = new Set(WORK_PLAN_UNIT_OPTIONS.map((option) => option.value));

export function isPresetActivity(value) {
  return WORK_PLAN_ACTIVITY_PRESETS.includes(value);
}

export function isUnitLockedForActivity(value) {
  return isPresetActivity(value);
}

export function toWorkPlanItemViewModel(row = {}) {
  const activityName = String(row.activity_name || '');
  const unit = String(row.unit || '');

  return {
    clientKey: row.clientKey || crypto.randomUUID(),
    id: row.id ?? null,
    activity_selection: isPresetActivity(activityName) ? activityName : (activityName ? OTHER_ACTIVITY : ''),
    activity_name: activityName,
    unit_selection: STANDARD_UNITS.has(unit) ? unit : (unit ? OTHER_UNIT : ''),
    unit,
    planned_quantity: row.planned_quantity?.toString() || '',
    unit_cost: row.unit_cost?.toString() || '',
    sort_order: row.sort_order?.toString() || '',
    remarks: row.remarks || '',
  };
}

export function applyActivitySelection(item, selection) {
  const defaultUnit = WORK_PLAN_DEFAULT_UNITS[selection] || '';
  return {
    ...item,
    activity_selection: selection,
    activity_name: isPresetActivity(selection) ? selection : '',
    unit_selection: defaultUnit,
    unit: defaultUnit,
  };
}

export function applyUnitSelection(item, selection) {
  if (isUnitLockedForActivity(item.activity_selection)) return item;

  return {
    ...item,
    unit_selection: selection,
    unit: selection === OTHER_UNIT ? '' : selection,
  };
}

export function getPlannedQuantityPlaceholder(activity) {
  if (activity === 'Earthworks') return 'e.g. 1,000 m\u00B3';
  if (activity === 'Drainage') return 'e.g. 500 m';
  if (activity === 'Gravel') return 'e.g. 800 m\u00B3';
  return 'Enter approved quantity';
}

export function formatPlannedQuantity(value) {
  if (value === null || value === undefined || value === '') return '\u2014';
  const number = Number(value);
  if (!Number.isFinite(number)) return '\u2014';
  return number.toLocaleString('en-PH', { maximumFractionDigits: 4 });
}

export function nextWorkPlanSortOrder(items) {
  const explicitOrders = items
    .filter((item) => item.sort_order !== '')
    .map((item) => Number(item.sort_order))
    .filter((value) => Number.isInteger(value));
  return String(explicitOrders.length ? Math.max(...explicitOrders) + 1 : items.length + 1);
}

export function hasDuplicatePreset(items, selection, clientKey) {
  return isPresetActivity(selection) && items.some((item) => (
    item.clientKey !== clientKey && item.activity_selection === selection
  ));
}

export function validateWorkPlanItems(items, options = {}) {
  const normalizedOptions = typeof options === 'boolean'
    ? { requireAtLeastOne: options }
    : options;
  const { requireAtLeastOne = false, requireUnitCost = false } = normalizedOptions;

  if (requireAtLeastOne && items.length === 0) {
    return 'At least one Work Plan item is required before finalization.';
  }

  const usedPresets = new Set();

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const rowLabel = `Row ${i + 1}`;

    if (!item.activity_selection) return `${rowLabel}: Select an activity.`;
    if (item.activity_selection === OTHER_ACTIVITY && !item.activity_name.trim()) {
      return `${rowLabel}: Specify the activity.`;
    }

    if (isPresetActivity(item.activity_selection)) {
      if (usedPresets.has(item.activity_selection)) {
        return `${item.activity_selection} already exists in this Work Plan.`;
      }
      usedPresets.add(item.activity_selection);

      if (item.unit !== WORK_PLAN_DEFAULT_UNITS[item.activity_selection]) {
        return `${rowLabel}: ${item.activity_selection} must use ${WORK_PLAN_DEFAULT_UNITS[item.activity_selection]}.`;
      }
    }

    if (!item.unit_selection) return `${rowLabel}: Select a unit of measure.`;
    if (item.unit_selection === OTHER_UNIT && !item.unit.trim()) {
      return `${rowLabel}: Specify the unit of measure.`;
    }
    if (item.unit.trim().length > 50) {
      return `${rowLabel}: Unit of measure must be 50 characters or fewer.`;
    }

    if (item.planned_quantity === '') {
      return `${rowLabel}: Enter the approved planned quantity.`;
    }
    const quantity = Number(item.planned_quantity);
    if (!Number.isFinite(quantity)) return `${rowLabel}: Enter a valid planned quantity.`;
    if (quantity <= 0) return `${rowLabel}: Planned quantity must be greater than 0.`;

    if (requireUnitCost && item.unit_cost === '') {
      return `${rowLabel}: Enter the approved unit cost.`;
    }
    if (item.unit_cost !== '') {
      const unitCost = Number(item.unit_cost);
      if (!Number.isFinite(unitCost)) return `${rowLabel}: Enter a valid unit cost.`;
      if (unitCost <= 0) return `${rowLabel}: Unit cost must be greater than ₱0.00.`;
      if (unitCost >= 10 ** 16) {
        return `${rowLabel}: Unit cost exceeds the supported amount.`;
      }
    }

    if (item.sort_order !== '' && !Number.isInteger(Number(item.sort_order))) {
      return `${rowLabel}: Sort order must be a whole number.`;
    }
  }

  return '';
}
