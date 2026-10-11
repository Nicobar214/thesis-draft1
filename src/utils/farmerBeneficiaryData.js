// Reference lists for farmer beneficiary records. (The old generated sample
// farmers were removed: analytics must only ever show real registry data.)

export const BENEFICIARY_CROPS = [
  'Rice', 'Corn', 'Sugarcane', 'Coconut', 'Vegetables', 'Banana',
  // Added from the Leon RSBSA farmer dataset (2026-07) -- granular crops
  // not covered by the original 6 broad categories.
  'Bellpepper (Green/Red)', 'Cacao', 'Carrot', 'Dragon Fruit', 'Long Chili',
  'Mango', 'Mongo - dry', 'Mung Bean', 'Other fruit-bearing trees and vines',
  'Other fruit-bearing vegetables', 'Other industrial crops', 'Other leafy vegetables',
  'Other leguminous plants', 'Papaya', 'Peanuts', 'Pepper - small green',
  'Pepper - sweet', 'Radish (labanos)', 'Squash (kalabasa)', 'Tomato (kamatis)',
];

export const BENEFICIARY_VALIDATION_STATUSES = [
  'Validated',
];

export const BENEFICIARY_STATUS_OPTIONS = ['Active Beneficiary', 'Under Review', 'Inactive'];
