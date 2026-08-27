import { buildPowerPriceUrl, summarizePowerPrices } from './power-prices.js?v=20260827-1';

const areaSelect = document.getElementById('power-area');
const status = document.getElementById('power-price-status');
const values = document.getElementById('power-price-values');
const currentPrice = document.getElementById('power-current-price');
const averagePrice = document.getElementById('power-average-price');
const rangePrice = document.getElementById('power-range-price');
const retryButton = document.getElementById('power-price-retry');

function formatPrice(value) {
  return Number(value).toLocaleString('nb-NO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function loadPowerPrices() {
  const area = areaSelect.value;
  status.textContent = 'Henter dagens spotpriser …';
  status.classList.remove('hidden');
  values.classList.add('hidden');
  retryButton.classList.add('hidden');
  areaSelect.disabled = true;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(buildPowerPriceUrl(new Date(), area), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Pris-API svarte med ${response.status}`);
    const summary = summarizePowerPrices(await response.json(), new Date());
    currentPrice.textContent = summary.current === null ? 'Ikke tilgjengelig' : `${formatPrice(summary.current)} kr/kWh`;
    averagePrice.textContent = `${formatPrice(summary.average)} kr/kWh`;
    rangePrice.textContent = `${formatPrice(summary.minimum)}–${formatPrice(summary.maximum)} kr/kWh`;
    status.classList.add('hidden');
    values.classList.remove('hidden');
    try { localStorage.setItem('kollektivmatch-power-area', area); } catch { /* valgfri lokal preferanse */ }
  } catch (error) {
    console.warn('Kunne ikke hente strømpriser:', error.message);
    status.textContent = 'Prisene er midlertidig utilgjengelige. Du kan prøve på nytt.';
    retryButton.classList.remove('hidden');
  } finally {
    window.clearTimeout(timeout);
    areaSelect.disabled = false;
  }
}

if (areaSelect) {
  try {
    const savedArea = localStorage.getItem('kollektivmatch-power-area');
    if ([...areaSelect.options].some((option) => option.value === savedArea)) areaSelect.value = savedArea;
  } catch { /* lokal lagring kan være blokkert */ }
  areaSelect.addEventListener('change', loadPowerPrices);
  retryButton.addEventListener('click', loadPowerPrices);
  loadPowerPrices();
}
