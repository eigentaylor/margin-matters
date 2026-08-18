// constants.js - Shared constants for the campaign game

// Electoral votes by state (approximate 2024/2028 values)
export const ELECTORAL_VOTES = {
  'CA': 54, 'TX': 40, 'FL': 30, 'NY': 28, 'PA': 19, 'IL': 19,
  'OH': 17, 'GA': 16, 'NC': 16, 'MI': 15, 'NJ': 14, 'VA': 13,
  'WA': 12, 'AZ': 11, 'MA': 11, 'TN': 11, 'IN': 11, 'MD': 10,
  'MN': 10, 'MO': 10, 'WI': 10, 'CO': 10, 'SC': 9, 'AL': 9,
  'LA': 8, 'KY': 8, 'OR': 8, 'OK': 7, 'CT': 7, 'IA': 6,
  'MS': 6, 'AR': 6, 'KS': 6, 'NV': 6, 'UT': 6, 'NM': 5,
  'WV': 4, 'NE': 5, 'ID': 4, 'HI': 4, 'NH': 4, 'ME': 4,
  'RI': 4, 'MT': 4, 'DE': 3, 'SD': 3, 'ND': 3, 'AK': 3,
  'VT': 3, 'WY': 3, 'DC': 3
};

// Get electoral votes for a state
export function getStateEV(abbr) {
  return ELECTORAL_VOTES[abbr] || 3;
}
