/* =========================================================
   PMSM THERMAL DIGITAL TWIN — FRONTEND CONTROLLER
   ========================================================= */

const API_BASE = 'https://motor-predictive-maintenance-b312.onrender.com';
const HEALTH_ENDPOINT = `${API_BASE}/`;
const PREDICT_ENDPOINT = `${API_BASE}/predict`;

const FIELD_IDS = [
  'stator_winding', 'stator_tooth', 'stator_yoke', 'coolant', 'pm', 'ambient',
  'motor_speed', 'torque', 'i_d', 'i_q', 'u_d', 'u_q'
];

const THRESHOLDS = {
  elevated: 90,
  critical: 110
};

const PRESETS = {
  normal: {
    stator_winding: 65.5, stator_tooth: 60.2, stator_yoke: 55.1,
    coolant: 30.0, pm: 58.4, ambient: 25.0,
    motor_speed: 3000, torque: 120, i_d: -100, i_q: 150, u_d: -40, u_q: 80
  },
  highload: {
    stator_winding: 88.0, stator_tooth: 84.5, stator_yoke: 79.0,
    coolant: 45.0, pm: 81.0, ambient: 32.0,
    motor_speed: 5200, torque: 240, i_d: -180, i_q: 260, u_d: -95, u_q: 150
  },
  stress: {
    stator_winding: 112.0, stator_tooth: 106.5, stator_yoke: 98.0,
    coolant: 68.0, pm: 101.5, ambient: 42.0,
    motor_speed: 7400, torque: 285, i_d: -260, i_q: 295, u_d: -160, u_q: 190
  }
};

let runCounter = 0;
let thermalChart = null;
let apiOnline = false;

/* ---------------- INITIALIZATION ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  syncInputs();
  bindPresetButtons();
  bindRunButton();
  bindClearChart();
  initChart();
  startClock();

  checkApiHealth();
  setInterval(checkApiHealth, 10000); // re-check health every 10s

  // Keep the "current" hero card reflecting the live stator_winding input
  const windingRow = document.querySelector('[data-field="stator_winding"] .number-input');
  if (windingRow) {
    windingRow.addEventListener('input', () => {
      updateCurrentTempCard(parseFloat(windingRow.value));
    });
  }
});

function startClock() {
  const clockEl = document.getElementById('sim-clock');
  const tick = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- 1. API HEALTH CHECK ---------------- */
async function checkApiHealth() {
  const badge = document.getElementById('api-status-badge');
  const text = document.getElementById('api-status-text');

  badge.dataset.state = 'checking';
  text.textContent = 'CHECKING…';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(HEALTH_ENDPOINT, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      badge.dataset.state = 'online';
      text.textContent = 'ONLINE';
      apiOnline = true;
    } else {
      throw new Error('Non-200 response');
    }
  } catch (err) {
    badge.dataset.state = 'offline';
    text.textContent = 'OFFLINE';
    apiOnline = false;
  }
}

/* ---------------- 2. SYNC RANGE + NUMBER INPUTS ---------------- */
function syncInputs() {
  document.querySelectorAll('.field-row').forEach((row) => {
    const range = row.querySelector('.range-input');
    const number = row.querySelector('.number-input');
    if (!range || !number) return;

    paintRangeTrack(range);

    range.addEventListener('input', () => {
      number.value = range.value;
      paintRangeTrack(range);
    });

    number.addEventListener('input', () => {
      let val = parseFloat(number.value);
      if (isNaN(val)) return;
      const min = parseFloat(range.min);
      const max = parseFloat(range.max);
      val = Math.min(Math.max(val, min), max);
      range.value = val;
      paintRangeTrack(range);
    });

    number.addEventListener('change', () => {
      // Snap out-of-range typed values back into bounds visually
      const min = parseFloat(range.min);
      const max = parseFloat(range.max);
      let val = parseFloat(number.value);
      if (isNaN(val)) val = min;
      val = Math.min(Math.max(val, min), max);
      number.value = val;
      range.value = val;
      paintRangeTrack(range);
    });
  });
}

// Fill the slider track behind the thumb with cyan up to current value
function paintRangeTrack(range) {
  const min = parseFloat(range.min);
  const max = parseFloat(range.max);
  const val = parseFloat(range.value);
  const pct = ((val - min) / (max - min)) * 100;
  range.style.background = `linear-gradient(90deg, var(--cyan) ${pct}%, var(--border-bevel-light) ${pct}%)`;
}

/* ---------------- 3. PRESET LOADING ---------------- */
function bindPresetButtons() {
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      loadPreset(btn.dataset.preset);
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function loadPreset(scenario) {
  const values = PRESETS[scenario];
  if (!values) return;

  FIELD_IDS.forEach((field) => {
    const row = document.querySelector(`[data-field="${field}"]`);
    if (!row) return;
    const range = row.querySelector('.range-input');
    const number = row.querySelector('.number-input');
    range.value = values[field];
    number.value = values[field];
    paintRangeTrack(range);
  });

  updateCurrentTempCard(values.stator_winding);
  addLogEntry(`Preset loaded: ${scenario.toUpperCase()}`, 'muted');
}

/* ---------------- 4. RUN PREDICTION ---------------- */
function bindRunButton() {
  const btn = document.getElementById('run-prediction-btn');
  btn.addEventListener('click', runPrediction);
}

function collectPayload() {
  const payload = {};
  FIELD_IDS.forEach((field) => {
    const row = document.querySelector(`[data-field="${field}"]`);
    const number = row.querySelector('.number-input');
    payload[field] = parseFloat(number.value);
  });
  return payload;
}

async function runPrediction() {
  const btn = document.getElementById('run-prediction-btn');
  const payload = collectPayload();

  btn.disabled = true;
  btn.classList.add('is-loading');
  const originalLabel = btn.querySelector('span').textContent;
  btn.querySelector('span').textContent = 'RUNNING SIMULATION…';

  const startTime = performance.now();

  try {
    const res = await fetch(PREDICT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`API returned status ${res.status}`);
    }

    const data = await res.json();
    const latency = (performance.now() - startTime).toFixed(0);

    handlePredictionResponse(payload, data, latency);
  } catch (err) {
    addLogEntry(`ERROR: ${err.message || 'Prediction request failed'}`, 'red');
    handleOfflineFallback(payload);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.querySelector('span').textContent = originalLabel;
  }
}

// Normalizes different possible FastAPI response shapes into a consistent object
function normalizePrediction(data) {
  const current = data.current_temp ?? data.current_winding_temp ?? data.stator_winding ?? null;
  const predicted = data.predicted_temp ?? data.predicted_winding_temp_60s ?? data.prediction ?? data.predicted_temp_60s ?? null;
  const status = (data.status ?? data.thermal_status ?? 'NORMAL').toString().toUpperCase();
  const anomaly = data.anomaly ?? data.anomaly_detected ?? false;
  const confidence = data.confidence ?? data.confidence_score ?? null;

  return { current, predicted, status, anomaly, confidence };
}

function handlePredictionResponse(payload, data, latency) {
  const { current, predicted, status, anomaly, confidence } = normalizePrediction(data);

  const currentTemp = current !== null ? current : payload.stator_winding;
  const predictedTemp = predicted !== null ? predicted : (payload.stator_winding + estimateFallbackDelta(payload));
  const delta = predictedTemp - currentTemp;

  updateCurrentTempCard(currentTemp);
  updatePredictedTempCard(predictedTemp);
  updateDeltaBadge(delta);
  updateStatusBanner(status, predictedTemp);
  updateAnomalyIndicator(anomaly);
  updateSecondaryReadouts(confidence, latency);
  updateChart(currentTemp, predictedTemp);

  runCounter++;
  document.getElementById('run-count-value').textContent = runCounter;

  addLogEntry(
    `RUN #${runCounter} · ${currentTemp.toFixed(1)}°C → ${predictedTemp.toFixed(1)}°C · ${status}`,
    status === 'CRITICAL_OVERHEAT_WARNING' ? 'red' : (status === 'ELEVATED_TEMPERATURE' ? 'amber' : 'default')
  );
}

// Physics-informed rough fallback estimate if backend is unreachable (demo continuity only)
function estimateFallbackDelta(payload) {
  const loadFactor = (Math.abs(payload.i_q) + Math.abs(payload.torque)) / 400;
  const coolingFactor = Math.max(0, (payload.coolant - payload.ambient)) / 60;
  return Math.max(-2, loadFactor * 6 - coolingFactor * 3);
}

function handleOfflineFallback(payload) {
  const currentTemp = payload.stator_winding;
  const delta = estimateFallbackDelta(payload);
  const predictedTemp = currentTemp + delta;
  const status = classifyStatus(predictedTemp);

  updateCurrentTempCard(currentTemp);
  updatePredictedTempCard(predictedTemp);
  updateDeltaBadge(delta);
  updateStatusBanner(status, predictedTemp);
  updateAnomalyIndicator(false);
  updateSecondaryReadouts(null, '—');
  updateChart(currentTemp, predictedTemp);

  runCounter++;
  document.getElementById('run-count-value').textContent = runCounter;
  addLogEntry(`RUN #${runCounter} (OFFLINE ESTIMATE) · ${status}`, 'amber');
}

function classifyStatus(temp) {
  if (temp >= THRESHOLDS.critical) return 'CRITICAL_OVERHEAT_WARNING';
  if (temp >= THRESHOLDS.elevated) return 'ELEVATED_TEMPERATURE';
  return 'NORMAL';
}

/* ---------------- HUD UPDATE HELPERS ---------------- */
function updateCurrentTempCard(temp) {
  const el = document.getElementById('current-temp-value');
  el.textContent = Number(temp).toFixed(1);
  applyTempLevelColor(el, temp);
}

function updatePredictedTempCard(temp) {
  const el = document.getElementById('predicted-temp-value');
  el.textContent = Number(temp).toFixed(1);
  applyTempLevelColor(el, temp);
}

function applyTempLevelColor(el, temp) {
  if (temp >= THRESHOLDS.critical) {
    el.dataset.level = 'critical';
  } else {
    delete el.dataset.level;
  }
}

function updateDeltaBadge(delta) {
  const badge = document.getElementById('delta-badge');
  const valueEl = document.getElementById('delta-value');
  const sign = delta >= 0 ? '+' : '';
  valueEl.textContent = `${sign}${delta.toFixed(2)} °C`;
  badge.dataset.direction = delta >= 0 ? 'up' : 'down';

  // refresh icon direction
  const icon = badge.querySelector('i');
  icon.setAttribute('data-lucide', delta >= 0 ? 'trending-up' : 'trending-down');
  if (window.lucide) lucide.createIcons();
}

function updateStatusBanner(status, predictedTemp) {
  const banner = document.getElementById('status-banner');
  const valueEl = document.getElementById('status-banner-value');
  const iconEl = document.getElementById('status-banner-icon');

  let state = 'normal';
  let icon = 'shield-check';
  let label = 'NORMAL';

  if (status.includes('CRITICAL') || predictedTemp >= THRESHOLDS.critical) {
    state = 'critical';
    icon = 'siren';
    label = 'CRITICAL_OVERHEAT_WARNING';
  } else if (status.includes('ELEVATED') || predictedTemp >= THRESHOLDS.elevated) {
    state = 'elevated';
    icon = 'triangle-alert';
    label = 'ELEVATED_TEMPERATURE';
  } else {
    state = 'normal';
    icon = 'shield-check';
    label = 'NORMAL';
  }

  banner.dataset.state = state;
  valueEl.textContent = label;
  iconEl.setAttribute('data-lucide', icon);
  if (window.lucide) lucide.createIcons();
}

function updateAnomalyIndicator(isAnomaly) {
  const indicator = document.getElementById('anomaly-indicator');
  const text = document.getElementById('anomaly-text');
  indicator.dataset.active = isAnomaly ? 'true' : 'false';
  text.textContent = isAnomaly ? 'ANOMALY DETECTED' : 'NO ANOMALY DETECTED';
}

function updateSecondaryReadouts(confidence, latency) {
  const confEl = document.getElementById('confidence-value');
  const latEl = document.getElementById('latency-value');
  confEl.textContent = confidence !== null && confidence !== undefined
    ? `${(confidence <= 1 ? confidence * 100 : confidence).toFixed(1)}%`
    : '—';
  latEl.textContent = latency !== undefined ? `${latency} ms` : '—';
}

function addLogEntry(message, level = 'default') {
  const list = document.getElementById('log-list');
  const entry = document.createElement('div');
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });

  entry.className = 'log-entry' + (level === 'muted' ? ' log-entry-muted' : level === 'amber' ? ' log-entry-amber' : level === 'red' ? ' log-entry-red' : '');
  entry.textContent = `[${time}] ${message}`;

  // Remove the initial placeholder if present
  const placeholder = list.querySelector('.log-entry-muted');
  if (placeholder && placeholder.textContent.includes('Awaiting first')) {
    placeholder.remove();
  }

  list.appendChild(entry);

  // cap log length
  while (list.children.length > 30) {
    list.removeChild(list.firstChild);
  }
}

/* ---------------- 5. CHART.JS INIT + UPDATE ---------------- */
function initChart() {
  const ctx = document.getElementById('thermal-chart').getContext('2d');

  thermalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Actual Winding Temp (°C)',
          data: [],
          borderColor: '#00F0FF',
          backgroundColor: 'rgba(0, 240, 255, 0.08)',
          pointBackgroundColor: '#00F0FF',
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          tension: 0.35,
          fill: true
        },
        {
          label: 'Predicted Temp +60s (°C)',
          data: [],
          borderColor: '#FFB800',
          backgroundColor: 'rgba(255, 184, 0, 0.07)',
          pointBackgroundColor: '#FFB800',
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          borderDash: [6, 4],
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#131B2E',
          borderColor: '#1E293B',
          borderWidth: 1,
          titleColor: '#E6EDF7',
          bodyColor: '#7E8CA3',
          titleFont: { family: 'Orbitron', size: 11 },
          bodyFont: { family: 'Inter', size: 11 },
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(30, 41, 59, 0.6)' },
          ticks: { color: '#4B5875', font: { family: 'Inter', size: 10 }, maxRotation: 0 }
        },
        y: {
          grid: { color: 'rgba(30, 41, 59, 0.6)' },
          ticks: { color: '#7E8CA3', font: { family: 'Orbitron', size: 10 } },
          title: { display: true, text: 'Temperature (°C)', color: '#4B5875', font: { family: 'Inter', size: 10 } }
        }
      }
    }
  });
}

function updateChart(currentTemp, predictedTemp) {
  if (!thermalChart) return;

  const label = `RUN ${thermalChart.data.labels.length + 1}`;
  thermalChart.data.labels.push(label);
  thermalChart.data.datasets[0].data.push(currentTemp);
  thermalChart.data.datasets[1].data.push(predictedTemp);

  // cap history to last 25 runs to keep chart readable
  const maxPoints = 25;
  if (thermalChart.data.labels.length > maxPoints) {
    thermalChart.data.labels.shift();
    thermalChart.data.datasets[0].data.shift();
    thermalChart.data.datasets[1].data.shift();
  }

  thermalChart.update();
}

function bindClearChart() {
  document.getElementById('clear-chart-btn').addEventListener('click', () => {
    if (!thermalChart) return;
    thermalChart.data.labels = [];
    thermalChart.data.datasets[0].data = [];
    thermalChart.data.datasets[1].data = [];
    thermalChart.update();
    runCounter = 0;
    document.getElementById('run-count-value').textContent = '0';
    addLogEntry('Chart history cleared.', 'muted');
  });
}
