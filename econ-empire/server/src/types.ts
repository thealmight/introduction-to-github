export const COUNTRY_CODES = ['USA', 'CHN', 'DEU', 'JPN', 'IND'] as const;
export type CountryCode = typeof COUNTRY_CODES[number];

export const PRODUCT_CODES = ['STEEL', 'GRAIN', 'OIL', 'ELEC', 'TEXT'] as const;
export type ProductCode = typeof PRODUCT_CODES[number];