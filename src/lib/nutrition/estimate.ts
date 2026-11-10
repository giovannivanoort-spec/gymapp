/**
 * Gedeeld tussen de app (PhotoEstimate) en de server (/api/nutrition/photo): grenzen voor een
 * schatting uit een beschrijving zonder foto. Eén plek, zodat de teller in de app en de controle op
 * de server nooit uit elkaar lopen.
 */
export const ESTIMATE_TEXT_MIN = 3;
export const ESTIMATE_TEXT_MAX = 300;
