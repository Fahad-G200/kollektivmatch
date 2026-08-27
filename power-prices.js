const VALID_AREAS = new Set(['NO1', 'NO2', 'NO3', 'NO4', 'NO5']);

export function buildPowerPriceUrl(date, area) {
  const selectedDate = date instanceof Date ? date : new Date(date);
  const selectedArea = String(area || '').toUpperCase();
  if (Number.isNaN(selectedDate.getTime())) throw new TypeError('Ugyldig dato');
  if (!VALID_AREAS.has(selectedArea)) throw new TypeError('Ugyldig prisområde');
  const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
  const day = String(selectedDate.getDate()).padStart(2, '0');
  return `https://www.hvakosterstrommen.no/api/v1/prices/${selectedDate.getFullYear()}/${month}-${day}_${selectedArea}.json`;
}

export function summarizePowerPrices(rows, now = new Date()) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => ({
    price: Number(row?.NOK_per_kWh),
    start: new Date(row?.time_start),
    end: new Date(row?.time_end),
  })).filter((row) => (
    Number.isFinite(row.price)
    && !Number.isNaN(row.start.getTime())
    && !Number.isNaN(row.end.getTime())
    && row.end > row.start
  ));

  if (!normalized.length) throw new TypeError('Prisdata mangler eller har feil format');
  const timestamp = now instanceof Date ? now : new Date(now);
  const current = normalized.find((row) => row.start <= timestamp && timestamp < row.end) || null;
  const prices = normalized.map((row) => row.price);

  return {
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    current: current?.price ?? null,
    minimum: Math.min(...prices),
    maximum: Math.max(...prices),
    count: normalized.length,
  };
}
