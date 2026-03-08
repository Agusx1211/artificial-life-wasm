const uiShell = document.querySelector("#ui-shell");
const form = document.querySelector("#controls-form");
const canvas = document.querySelector("#universe-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const worldCanvas = document.createElement("canvas");
const worldCtx = worldCanvas.getContext("2d", { alpha: false });

const toggleButton = document.querySelector("#toggle-button");
const stepButton = document.querySelector("#step-button");
const quickResetButton = document.querySelector("#quick-reset-button");
const settingsButton = document.querySelector("#settings-button");
const hideUiButton = document.querySelector("#hide-ui-button");
const fastPresetButton = document.querySelector("#fast-preset");
const originalPresetButton = document.querySelector("#original-preset");
const speedDownButton = document.querySelector("#speed-down-button");
const speedUpButton = document.querySelector("#speed-up-button");

const statePill = document.querySelector("#state-pill");
const engineValue = document.querySelector("#engine-value");
const epochValue = document.querySelector("#epoch-value");
const opcodeValue = document.querySelector("#opcode-value");
const zoomValue = document.querySelector("#zoom-value");
const speedValue = document.querySelector("#speed-value");
const throughputValue = document.querySelector("#throughput-value");
const runtimeNote = document.querySelector("#runtime-note");
const statusLine = document.querySelector("#status-line");
const resolutionNote = document.querySelector("#resolution-note");
const secureLink = document.querySelector("#secure-link");

const seedInput = document.querySelector("#seed-input");
const threadsSelect = document.querySelector("#threads-select");
const speedSelect = document.querySelector("#speed-select");
const widthInput = document.querySelector("#width-input");
const heightInput = document.querySelector("#height-input");
const mutationInput = document.querySelector("#mutation-input");
const epochsInput = document.querySelector("#epochs-input");

const inspectPanel = document.querySelector("#inspect-panel");
const inspectTitle = document.querySelector("#inspect-title");
const inspectCoordValue = document.querySelector("#inspect-coord-value");
const inspectPeerValue = document.querySelector("#inspect-peer-value");
const tracePcValue = document.querySelector("#trace-pc-value");
const traceHead0Value = document.querySelector("#trace-head0-value");
const traceHead1Value = document.querySelector("#trace-head1-value");
const traceStepsValue = document.querySelector("#trace-steps-value");
const inspectPeerSelect = document.querySelector("#inspect-peer-select");
const inspectCloseButton = document.querySelector("#inspect-close-button");
const inspectCaptureButton = document.querySelector("#inspect-capture-button");
const traceToggleButton = document.querySelector("#trace-toggle-button");
const traceStepButton = document.querySelector("#trace-step-button");
const traceResetButton = document.querySelector("#trace-reset-button");
const traceLeftGrid = document.querySelector("#trace-left-grid");
const traceRightGrid = document.querySelector("#trace-right-grid");
const traceStatus = document.querySelector("#trace-status");

const MODULE_VERSION = "16";
const SIMULATION_BUDGET_MS = 10;
const PRESENT_INTERVAL_MS = 16;
const STATS_INTERVAL_MS = 200;
const TRACE_PLAY_STEPS_PER_FRAME = 8;
const SPEED_STEP_COST_MS = 16;
const MAX_SIMULATION_ACCUMULATOR_MS = SPEED_STEP_COST_MS * 8;
const DEFAULT_HTTPS_PORT = "8443";
const TAPE_SIZE = 64;
const TAPE_SIDE = 8;
const PAIR_TAPE_SIZE = TAPE_SIZE * 2;
const LIVE_PEER_VALUE = "last";
const ORIGINAL_GRID = {
  height: 135,
  width: 240,
};
const FAST_GRID = {
  height: 68,
  width: 120,
};
const DEFAULT_CONFIG = {
  epochsPerFrame: 1,
  height: ORIGINAL_GRID.height,
  mutationPercent: 0.024,
  seed: 1,
  speedMode: "max",
  threadSetting: "auto",
  width: ORIGINAL_GRID.width,
};
const GRID_LIMITS = {
  height: { min: 8, max: 4096 },
  maxPrograms: 262144,
  width: { min: 8, max: 4096 },
};
const EPOCH_LIMITS = { min: 1, max: 128 };
const MUTATION_LIMITS = { min: 0, max: 5 };
const SPOOFED_CORE_FALLBACK = 8;
const LOCALHOST_NAMES = new Set(["127.0.0.1", "localhost"]);
const CAMERA_MAX_ZOOM = 24;
const POINTER_TAP_THRESHOLD = 10;
const SPEED_OPTIONS = [
  "0.01",
  "0.02",
  "0.05",
  "0.1",
  "0.25",
  "0.5",
  "1",
  "2",
  "4",
  "max",
];
const OPCODE_BYTES = new Map(
  ["<", ">", "{", "}", "-", "+", ".", ",", "[", "]"].map((char) => [
    char.charCodeAt(0),
    char,
  ]),
);

ctx.imageSmoothingEnabled = false;
worldCtx.imageSmoothingEnabled = false;

let wasmPkg = null;
let universe = null;
let imageData = null;
let wasmMemory = null;
let currentConfig = { ...DEFAULT_CONFIG };
let currentRequestedThreadCount = 1;
let currentForcedEngineMode = "auto";
let running = true;
let settingsOpen = false;
let uiHidden = false;
let lastSampleTime = performance.now();
let lastSampleEpoch = 0;
let lastStatsPaintTime = 0;
let currentThroughput = 0;
let engineStatus = "loading wasm...";
let frameNeedsUpload = false;
let viewNeedsDraw = true;
let lastPresentTime = 0;
let inspector = null;
let traceRunning = false;
let selection = null;
let lastSimulationTime = performance.now();
let simulationAccumulator = 0;
let inspectMode = "live";

const camera = {
  centerX: 0,
  centerY: 0,
  zoom: 1,
  minZoom: 1,
  maxZoom: CAMERA_MAX_ZOOM,
};

const activePointers = new Map();
let gesture = null;
const leftGridCells = buildCodeGrid(traceLeftGrid);
const rightGridCells = buildCodeGrid(traceRightGrid);

function getSearchParams() {
  return new URLSearchParams(window.location.search);
}

function isLoopbackHost(hostname = window.location.hostname) {
  return LOCALHOST_NAMES.has(hostname);
}

function buildSecureUrl() {
  const url = new URL(window.location.href);
  url.protocol = "https:";
  url.port = DEFAULT_HTTPS_PORT;
  return url;
}

function shouldShowSecureLink() {
  return window.location.protocol === "http:" && !isLoopbackHost();
}

function clampInteger(rawValue, fallback, min, max) {
  const value = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function clampFloat(rawValue, fallback, min, max) {
  const value = Number.parseFloat(rawValue ?? "");
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatMutationPercent(value) {
  return Number(value.toFixed(3)).toString();
}

function normalizeSpeedMode(value) {
  const stringValue = String(value ?? "max");
  return SPEED_OPTIONS.includes(stringValue) ? stringValue : DEFAULT_CONFIG.speedMode;
}

function formatSpeedLabel(speedMode) {
  return speedMode === "max" ? "max" : `${Number.parseFloat(speedMode).toFixed(2)}x`;
}

function getSpeedMultiplier(speedMode = currentConfig.speedMode) {
  return speedMode === "max" ? null : Number.parseFloat(speedMode);
}

function resetSimulationPacing() {
  lastSimulationTime = performance.now();
  simulationAccumulator = 0;
}

function formatZoomLabel() {
  return `${camera.zoom.toFixed(2)}x`;
}

function formatGridLabel(width = currentConfig.width, height = currentConfig.height) {
  return `${width}x${height}`;
}

function updateResolutionReadout() {
  resolutionNote.textContent = formatGridLabel();
  resolutionNote.title = `${worldCanvas.width}x${worldCanvas.height} rendered pixels`;
}

function validateGridSize(width, height) {
  return width * height <= GRID_LIMITS.maxPrograms;
}

function describeGridLimit() {
  return `grid too large. keep width*height <= ${GRID_LIMITS.maxPrograms.toLocaleString()} colonies.`;
}

function normalizeThreadSetting(value) {
  if (value === "auto" || value == null || value === "") {
    return "auto";
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "auto";
  }

  return String(parsed);
}

function ensureThreadOptionAvailable(value) {
  const normalized = normalizeThreadSetting(value);
  if (
    normalized === "auto" ||
    threadsSelect.querySelector(`option[value="${normalized}"]`)
  ) {
    return normalized;
  }

  const option = document.createElement("option");
  option.value = normalized;
  option.textContent = normalized;
  threadsSelect.append(option);
  return normalized;
}

function getForcedEngineMode() {
  const value = getSearchParams().get("engine");
  return value === "single" || value === "threaded" ? value : "auto";
}

function getThreadSelectionFromUrl() {
  const params = getSearchParams();
  const threadSetting = normalizeThreadSetting(params.get("threads"));
  if (threadSetting !== "auto") {
    return ensureThreadOptionAvailable(threadSetting);
  }

  if (params.get("engine") === "single") {
    return ensureThreadOptionAvailable("1");
  }

  return "auto";
}

function supportsThreading() {
  return (
    window.isSecureContext &&
    window.crossOriginIsolated &&
    typeof SharedArrayBuffer !== "undefined" &&
    typeof Atomics !== "undefined"
  );
}

function getRequestedThreadCount(threadSetting = getThreadSelectionFromUrl()) {
  const normalized = normalizeThreadSetting(threadSetting);
  if (normalized !== "auto") {
    return Number.parseInt(normalized, 10);
  }

  const reported = Math.max(1, navigator.hardwareConcurrency || 1);
  if (supportsThreading() && reported <= 1) {
    return SPOOFED_CORE_FALLBACK;
  }

  return reported;
}

function readConfigFromUrl() {
  const params = getSearchParams();
  const width = clampInteger(
    params.get("width"),
    DEFAULT_CONFIG.width,
    GRID_LIMITS.width.min,
    GRID_LIMITS.width.max,
  );
  const height = clampInteger(
    params.get("height"),
    DEFAULT_CONFIG.height,
    GRID_LIMITS.height.min,
    GRID_LIMITS.height.max,
  );

  return {
    seed: clampInteger(
      params.get("seed"),
      DEFAULT_CONFIG.seed,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    width: validateGridSize(width, height) ? width : DEFAULT_CONFIG.width,
    height: validateGridSize(width, height) ? height : DEFAULT_CONFIG.height,
    mutationPercent: clampFloat(
      params.get("mutation"),
      DEFAULT_CONFIG.mutationPercent,
      MUTATION_LIMITS.min,
      MUTATION_LIMITS.max,
    ),
    epochsPerFrame: clampInteger(
      params.get("epochs"),
      DEFAULT_CONFIG.epochsPerFrame,
      EPOCH_LIMITS.min,
      EPOCH_LIMITS.max,
    ),
    speedMode: normalizeSpeedMode(params.get("sim_speed")),
    threadSetting: getThreadSelectionFromUrl(),
  };
}

function readConfigFromInputs() {
  return {
    seed: clampInteger(seedInput.value, DEFAULT_CONFIG.seed, 0, Number.MAX_SAFE_INTEGER),
    width: clampInteger(
      widthInput.value,
      DEFAULT_CONFIG.width,
      GRID_LIMITS.width.min,
      GRID_LIMITS.width.max,
    ),
    height: clampInteger(
      heightInput.value,
      DEFAULT_CONFIG.height,
      GRID_LIMITS.height.min,
      GRID_LIMITS.height.max,
    ),
    mutationPercent: clampFloat(
      mutationInput.value,
      DEFAULT_CONFIG.mutationPercent,
      MUTATION_LIMITS.min,
      MUTATION_LIMITS.max,
    ),
    epochsPerFrame: clampInteger(
      epochsInput.value,
      DEFAULT_CONFIG.epochsPerFrame,
      EPOCH_LIMITS.min,
      EPOCH_LIMITS.max,
    ),
    speedMode: normalizeSpeedMode(speedSelect.value),
    threadSetting: ensureThreadOptionAvailable(threadsSelect.value),
  };
}

function syncInputsWithConfig(config) {
  seedInput.value = String(config.seed);
  speedSelect.value = normalizeSpeedMode(config.speedMode);
  widthInput.value = String(config.width);
  heightInput.value = String(config.height);
  mutationInput.value = formatMutationPercent(config.mutationPercent);
  epochsInput.value = String(config.epochsPerFrame);
  threadsSelect.value = ensureThreadOptionAvailable(config.threadSetting);
  speedValue.textContent = formatSpeedLabel(config.speedMode);
}

function buildConfigUrl(config) {
  const url = new URL(window.location.href);

  url.searchParams.set("seed", String(config.seed));
  url.searchParams.set("width", String(config.width));
  url.searchParams.set("height", String(config.height));
  url.searchParams.set("epochs", String(config.epochsPerFrame));
  url.searchParams.set("mutation", formatMutationPercent(config.mutationPercent));
  url.searchParams.set("sim_speed", normalizeSpeedMode(config.speedMode));

  if (config.threadSetting === "auto") {
    url.searchParams.delete("threads");
    url.searchParams.delete("engine");
  } else {
    url.searchParams.set("threads", config.threadSetting);
    url.searchParams.set(
      "engine",
      config.threadSetting === "1" ? "single" : "threaded",
    );
  }

  return url;
}

function validateConfig(config) {
  if (!validateGridSize(config.width, config.height)) {
    return describeGridLimit();
  }

  return null;
}

function buildNavigationUrl(config) {
  const url = buildConfigUrl(config);
  if (normalizeThreadSetting(config.threadSetting) !== "1" && shouldShowSecureLink()) {
    url.protocol = "https:";
    url.port = DEFAULT_HTTPS_PORT;
  }
  return url;
}

function buildCodeGrid(container) {
  const cells = [];
  for (let index = 0; index < TAPE_SIZE; index += 1) {
    const cell = document.createElement("span");
    cell.className = "code-cell";
    cell.textContent = ".";
    container.append(cell);
    cells.push(cell);
  }
  return cells;
}

function formatProgramLabel(index) {
  const { x, y } = indexToCoord(index);
  return `${x},${y}`;
}

function indexToCoord(index) {
  return {
    x: index % currentConfig.width,
    y: Math.floor(index / currentConfig.width),
  };
}

function formatTapeSymbol(value) {
  return OPCODE_BYTES.get(value) ?? ".";
}

function formatTapeByte(value) {
  return `0x${value.toString(16).padStart(2, "0")}`;
}

function freeInspector() {
  if (!inspector) {
    return;
  }

  traceRunning = false;
  traceToggleButton.textContent = "play";
  inspector.free();
  inspector = null;
}

function clearSelection() {
  freeInspector();
  inspectMode = "live";
  selection = null;
  inspectPanel.hidden = true;
  viewNeedsDraw = true;
}

function updateCameraReadout() {
  zoomValue.textContent = formatZoomLabel();
}

function setSettingsOpen(nextValue) {
  settingsOpen = nextValue && !uiHidden;
  form.hidden = !settingsOpen;
  settingsButton.textContent = settingsOpen ? "close" : "tune";
  settingsButton.setAttribute("aria-expanded", String(settingsOpen));
}

function setUiHidden(nextValue) {
  uiHidden = nextValue;
  if (uiHidden) {
    setSettingsOpen(false);
    traceRunning = false;
    traceToggleButton.textContent = "play";
  }
  uiShell.hidden = uiHidden;
  canvas.classList.remove("is-grabbing");
  gesture = null;
  activePointers.clear();
  publishDebugSnapshot();
}

function publishDebugSnapshot() {
  window.__artificialLifeDebug = {
    actualThreadCount: universe?.thread_count?.() ?? null,
    config: currentConfig,
    crossOriginIsolated: window.crossOriginIsolated,
    engineLabel: engineValue.textContent,
    epoch: universe?.epoch?.() ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
    inspectMode,
    isSecureContext: window.isSecureContext,
    opcodePercent: universe?.opcode_percent?.() ?? null,
    requestedThreadCount: currentRequestedThreadCount,
    selectedPartnerIndex: selection?.partnerIndex ?? null,
    selectedPartnerMode: selection?.partnerMode ?? null,
    stateLabel: statePill.textContent,
    statusLine: statusLine.textContent,
    throughputLabel: throughputValue.textContent,
    uiHidden,
    selectedProgramIndex: selection?.index ?? null,
    zoom: camera.zoom,
  };
}

function setStatus(message) {
  statusLine.textContent = message;
  updateSurfaceHints();
  publishDebugSnapshot();
}

function composeStatus(message) {
  return `${engineStatus} ${message}`.trim();
}

function setRunning(nextValue) {
  running = nextValue;
  resetSimulationPacing();
  toggleButton.textContent = running ? "pause" : "run";
  statePill.textContent = running ? "run" : "pause";
  updateSurfaceHints();
  publishDebugSnapshot();
}

function buildLocalThreadHint() {
  return `open http://127.0.0.1:${window.location.port}/ on this machine for multicore.`;
}

function buildRuntimeNote() {
  if (statePill.textContent === "error") {
    return statusLine.textContent;
  }

  if (engineValue.textContent === "single-core") {
    if (!window.isSecureContext && shouldShowSecureLink()) {
      return "lan http disables threads. switch to the secure url.";
    }
    if (!window.isSecureContext) {
      return "threads need a secure context.";
    }
    if (!window.crossOriginIsolated) {
      return "threads are blocked by browser isolation.";
    }
    if (currentForcedEngineMode === "single" || currentRequestedThreadCount === 1) {
      return "single-core mode is selected.";
    }
    return "threaded wasm is unavailable in this browser session.";
  }

  if (!wasmPkg) {
    return "compiling webassembly...";
  }

  return "";
}

function updateSurfaceHints() {
  const note = buildRuntimeNote();
  runtimeNote.hidden = note === "";
  runtimeNote.textContent = note || "compiling webassembly...";

  if (shouldShowSecureLink()) {
    secureLink.hidden = false;
    secureLink.href = buildSecureUrl().toString();
  } else {
    secureLink.hidden = true;
  }
}

function describeSingleCoreFallback(error) {
  if (currentForcedEngineMode === "single") {
    return "single-core mode forced by url.";
  }
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `single-core fallback. threaded wasm init failed: ${message}`;
  }
  if (!window.isSecureContext) {
    if (shouldShowSecureLink()) {
      return `single-core fallback. open ${buildSecureUrl().toString()} and accept the local certificate warning.`;
    }
    return `single-core fallback. this origin is not secure for sharedarraybuffer. ${buildLocalThreadHint()}`;
  }
  if (!window.crossOriginIsolated) {
    return "single-core fallback. cross-origin isolation is unavailable.";
  }
  if ((navigator.hardwareConcurrency || 1) <= 1 && supportsThreading()) {
    return `single-core fallback. browser reported one core, app requested ${currentRequestedThreadCount}.`;
  }
  return "single-core fallback. browser wasm threads are unavailable here.";
}

async function loadThreadedPackage(requestedThreads) {
  const threadedPkg = await import(
    `./pkg-threaded/artificial_life_wasm.js?v=${MODULE_VERSION}`
  );
  await threadedPkg.default();
  await threadedPkg.initThreadPool(requestedThreads);

  wasmPkg = threadedPkg;
  wasmMemory = threadedPkg.wasm_memory();
  engineValue.textContent = `threaded x${requestedThreads}`;
  engineStatus = `${requestedThreads} wasm workers requested.`;
}

async function loadSinglePackage(reason) {
  const singlePkg = await import(
    `./pkg-single/artificial_life_wasm.js?v=${MODULE_VERSION}`
  );
  await singlePkg.default();

  wasmPkg = singlePkg;
  wasmMemory = singlePkg.wasm_memory();
  engineValue.textContent = "single-core";
  engineStatus = reason;
}

async function loadWasmPackage() {
  currentForcedEngineMode = getForcedEngineMode();
  currentRequestedThreadCount = getRequestedThreadCount(currentConfig.threadSetting);

  const canTryThreaded =
    currentForcedEngineMode !== "single" &&
    supportsThreading() &&
    currentRequestedThreadCount > 1;

  if (canTryThreaded) {
    try {
      await loadThreadedPackage(currentRequestedThreadCount);
      return;
    } catch (error) {
      console.error("Threaded WebAssembly init failed", error);
      await loadSinglePackage(describeSingleCoreFallback(error));
      return;
    }
  }

  await loadSinglePackage(describeSingleCoreFallback());
}

function getViewportScaleBounds() {
  if (!worldCanvas.width || !worldCanvas.height || !canvas.width || !canvas.height) {
    return { coverScale: 1, fitScale: 1, minZoom: 1 };
  }

  const coverScale = Math.max(
    canvas.width / worldCanvas.width,
    canvas.height / worldCanvas.height,
  );
  const fitScale = Math.min(
    canvas.width / worldCanvas.width,
    canvas.height / worldCanvas.height,
  );

  return {
    coverScale,
    fitScale,
    minZoom: clampNumber(fitScale / coverScale, 0.1, 1),
  };
}

function getEffectiveScale() {
  const { coverScale } = getViewportScaleBounds();
  return coverScale * camera.zoom;
}

function clampCamera() {
  if (!worldCanvas.width || !worldCanvas.height || !canvas.width || !canvas.height) {
    return;
  }

  const scale = getEffectiveScale();
  const halfViewWidth = canvas.width / (2 * scale);
  const halfViewHeight = canvas.height / (2 * scale);
  const halfWorldWidth = worldCanvas.width / 2;
  const halfWorldHeight = worldCanvas.height / 2;

  if (halfViewWidth >= halfWorldWidth) {
    camera.centerX = halfWorldWidth;
  } else {
    camera.centerX = clampNumber(
      camera.centerX,
      halfViewWidth,
      worldCanvas.width - halfViewWidth,
    );
  }

  if (halfViewHeight >= halfWorldHeight) {
    camera.centerY = halfWorldHeight;
  } else {
    camera.centerY = clampNumber(
      camera.centerY,
      halfViewHeight,
      worldCanvas.height - halfViewHeight,
    );
  }
}

function refreshCameraBounds() {
  const { minZoom } = getViewportScaleBounds();
  camera.minZoom = minZoom;
  camera.maxZoom = CAMERA_MAX_ZOOM;
  camera.zoom = clampNumber(camera.zoom, camera.minZoom, camera.maxZoom);
  clampCamera();
  updateCameraReadout();
}

function resetCamera() {
  camera.centerX = worldCanvas.width / 2;
  camera.centerY = worldCanvas.height / 2;
  camera.zoom = 1;
  refreshCameraBounds();
  viewNeedsDraw = true;
}

function resizeDisplayCanvas() {
  const nextWidth = Math.max(1, Math.round(window.innerWidth * window.devicePixelRatio));
  const nextHeight = Math.max(1, Math.round(window.innerHeight * window.devicePixelRatio));

  if (canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  ctx.imageSmoothingEnabled = false;
  refreshCameraBounds();
  viewNeedsDraw = true;
}

function setupCanvas() {
  worldCanvas.width = universe.canvas_width();
  worldCanvas.height = universe.canvas_height();
  imageData = worldCtx.createImageData(worldCanvas.width, worldCanvas.height);
  updateResolutionReadout();
  resizeDisplayCanvas();
  resetCamera();
  frameNeedsUpload = true;
}

function uploadUniverseFrame() {
  universe.render();
  if (!wasmMemory) {
    throw new Error("WebAssembly memory is not initialized");
  }

  const frame = new Uint8ClampedArray(
    wasmMemory.buffer,
    universe.frame_ptr(),
    universe.frame_len(),
  );
  imageData.data.set(frame);
  worldCtx.putImageData(imageData, 0, 0);
  frameNeedsUpload = false;
  viewNeedsDraw = true;
}

function drawViewport() {
  if (!worldCanvas.width || !worldCanvas.height || !canvas.width || !canvas.height) {
    return;
  }

  const scale = getEffectiveScale();
  const drawWidth = worldCanvas.width * scale;
  const drawHeight = worldCanvas.height * scale;
  const drawX = Math.round(canvas.width / 2 - camera.centerX * scale);
  const drawY = Math.round(canvas.height / 2 - camera.centerY * scale);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(worldCanvas, drawX, drawY, drawWidth, drawHeight);
  drawSelectionOverlay(scale, drawX, drawY);
  viewNeedsDraw = false;
}

function drawSelectionOverlay(scale, drawX, drawY) {
  if (!selection) {
    return;
  }

  const lineWidth = Math.max(1, Math.round(window.devicePixelRatio));
  const drawProgramOutline = (index, color) => {
    const { x, y } = indexToCoord(index);
    const left = drawX + x * TAPE_SIDE * scale;
    const top = drawY + y * TAPE_SIDE * scale;
    const size = TAPE_SIDE * scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(left + lineWidth / 2, top + lineWidth / 2, size - lineWidth, size - lineWidth);
  };

  drawProgramOutline(selection.index, "rgba(153, 226, 191, 0.95)");
  if (selection.partnerIndex !== selection.index) {
    drawProgramOutline(selection.partnerIndex, "rgba(112, 169, 255, 0.95)");
  }
}

function presentNow(forceStats = false) {
  if (!universe) {
    return;
  }

  if (frameNeedsUpload) {
    uploadUniverseFrame();
  }
  if (viewNeedsDraw) {
    drawViewport();
    lastPresentTime = performance.now();
  }
  if (forceStats) {
    updateStats(performance.now());
  }
}

function screenToWorld(screenX, screenY) {
  const scale = getEffectiveScale();
  return {
    x: camera.centerX + (screenX - canvas.width / 2) / scale,
    y: camera.centerY + (screenY - canvas.height / 2) / scale,
  };
}

function clientToCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}

function getProgramIndexFromCanvasPoint(point) {
  const world = screenToWorld(point.x, point.y);
  if (
    world.x < 0 ||
    world.y < 0 ||
    world.x >= worldCanvas.width ||
    world.y >= worldCanvas.height
  ) {
    return null;
  }

  const programX = clampNumber(Math.floor(world.x / TAPE_SIDE), 0, currentConfig.width - 1);
  const programY = clampNumber(Math.floor(world.y / TAPE_SIDE), 0, currentConfig.height - 1);
  return programY * currentConfig.width + programX;
}

function buildPartnerOptions(programIndex) {
  const options = [];
  const seen = new Set([programIndex]);
  const neighbors = [];
  const neighborCount = universe.neighbor_count(programIndex);
  for (let slot = 0; slot < neighborCount; slot += 1) {
    const neighbor = universe.neighbor_at(programIndex, slot);
    if (neighbor < 0 || seen.has(neighbor)) {
      continue;
    }

    neighbors.push(neighbor);
    seen.add(neighbor);
  }

  if (neighbors.length > 0) {
    const lastPartner = universe.last_partner(programIndex);
    if (lastPartner >= 0 && lastPartner !== programIndex) {
      options.push({
        value: LIVE_PEER_VALUE,
        index: lastPartner,
        label: `live ${formatProgramLabel(lastPartner)}`,
      });
    } else {
      options.push({
        value: LIVE_PEER_VALUE,
        index: neighbors[0],
        label: "live auto",
      });
    }
  }

  for (const neighbor of neighbors) {
    options.push({
      value: String(neighbor),
      index: neighbor,
      label: formatProgramLabel(neighbor),
    });
  }

  return options;
}

function syncPeerSelect(options, selectedValue) {
  inspectPeerSelect.replaceChildren();
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    inspectPeerSelect.append(option);
  }
  inspectPeerSelect.value = selectedValue;
}

function buildPartnerSignature(options) {
  return options
    .map((option) =>
      option.value === LIVE_PEER_VALUE ? LIVE_PEER_VALUE : `${option.value}:${option.index}`,
    )
    .join("|");
}

function syncSelectionPartnerState(forceDomSync = false) {
  if (!selection || !universe) {
    return false;
  }

  const programCount = currentConfig.width * currentConfig.height;
  if (selection.index >= programCount) {
    clearSelection();
    return false;
  }

  const options = buildPartnerOptions(selection.index);
  if (options.length === 0) {
    clearSelection();
    return false;
  }

  const requestedMode = selection.partnerMode ?? options[0].value;
  const resolvedOption =
    requestedMode === LIVE_PEER_VALUE
      ? options.find((option) => option.value === LIVE_PEER_VALUE) ?? options[0]
      : options.find((option) => option.value === requestedMode) ?? options[0];
  const signature = buildPartnerSignature(options);

  selection.partnerMode =
    requestedMode === LIVE_PEER_VALUE ? LIVE_PEER_VALUE : resolvedOption.value;
  selection.partnerIndex = resolvedOption.index;
  selection.partnerOptions = options;

  if (forceDomSync || selection.partnerSignature !== signature) {
    syncPeerSelect(options, selection.partnerMode);
    selection.partnerSignature = signature;
  } else if (inspectPeerSelect.value !== selection.partnerMode) {
    inspectPeerSelect.value = selection.partnerMode;
  }

  const liveOption = options.find((option) => option.value === LIVE_PEER_VALUE);
  const liveOptionNode = inspectPeerSelect.querySelector(`option[value="${LIVE_PEER_VALUE}"]`);
  if (liveOption && liveOptionNode && liveOptionNode.textContent !== liveOption.label) {
    liveOptionNode.textContent = liveOption.label;
  }

  return true;
}

function readLiveProgramTape(programIndex) {
  if (!universe || !wasmMemory) {
    return null;
  }

  try {
    const ptr = universe.program_ptr(programIndex);
    return new Uint8Array(wasmMemory.buffer, ptr, universe.program_len());
  } catch (error) {
    console.error("Failed to read live program tape", error);
    return null;
  }
}

function renderTape(cells, tape, { offset = 0, pc = -1, head0 = -1, head1 = -1 } = {}) {
  for (let index = 0; index < TAPE_SIZE; index += 1) {
    const sourceIndex = offset + index;
    const value = tape[sourceIndex];
    const cell = cells[index];
    cell.textContent = formatTapeSymbol(value);
    cell.classList.toggle("is-opcode", OPCODE_BYTES.has(value));
    cell.classList.toggle("is-pc", pc === sourceIndex);
    cell.classList.toggle("is-head0", head0 === sourceIndex);
    cell.classList.toggle("is-head1", head1 === sourceIndex);
    cell.title = `${sourceIndex} ${formatTapeByte(value)}`;
  }
}

function renderInspector() {
  if (!selection || !universe) {
    inspectPanel.hidden = true;
    return;
  }

  if (inspectMode === "live") {
    const previousPartnerIndex = selection.partnerIndex;
    if (!syncSelectionPartnerState()) {
      return;
    }

    const leftTape = readLiveProgramTape(selection.index);
    const rightTape = readLiveProgramTape(selection.partnerIndex);
    if (!leftTape || !rightTape) {
      clearSelection();
      return;
    }

    const epoch = universe.epoch();
    const peerLabel = formatProgramLabel(selection.partnerIndex);
    const liveLabel =
      selection.partnerMode === LIVE_PEER_VALUE
        ? `following ${peerLabel}`
        : `pinned ${peerLabel}`;

    inspectPanel.hidden = false;
    inspectTitle.textContent = `cell ${formatProgramLabel(selection.index)} @ e${epoch}`;
    inspectCoordValue.textContent = formatProgramLabel(selection.index);
    inspectPeerValue.textContent =
      selection.partnerMode === LIVE_PEER_VALUE ? `live ${peerLabel}` : peerLabel;
    tracePcValue.textContent = "--";
    traceHead0Value.textContent = "--";
    traceHead1Value.textContent = "--";
    traceStepsValue.textContent = "--";
    traceStatus.textContent = `live e${epoch} ${liveLabel}`;
    traceToggleButton.textContent = "play";
    traceResetButton.disabled = true;
    renderTape(leftGridCells, leftTape);
    renderTape(rightGridCells, rightTape);
    if (previousPartnerIndex !== selection.partnerIndex) {
      viewNeedsDraw = true;
    }
    return;
  }

  if (!inspector) {
    inspectMode = "live";
    renderInspector();
    return;
  }

  const tape = new Uint8Array(wasmMemory.buffer, inspector.tape_ptr(), inspector.tape_len());
  const rawPc = inspector.pc();
  const pc = rawPc >= 0 && rawPc < PAIR_TAPE_SIZE ? rawPc : -1;
  const head0 = inspector.head0();
  const head1 = inspector.head1();
  const peerLabel = formatProgramLabel(selection.partnerIndex);
  const halted = inspector.halted();

  inspectPanel.hidden = false;
  inspectTitle.textContent = `cell ${formatProgramLabel(selection.index)} @ e${selection.snapshotEpoch}`;
  inspectCoordValue.textContent = formatProgramLabel(selection.index);
  inspectPeerValue.textContent = peerLabel;
  tracePcValue.textContent = rawPc >= 0 ? String(rawPc) : "--";
  traceHead0Value.textContent = String(head0);
  traceHead1Value.textContent = String(head1);
  traceStepsValue.textContent = String(inspector.steps());
  traceStatus.textContent = halted
    ? `halted: ${inspector.halt_reason()}`
    : `snapshot e${selection.snapshotEpoch} ${formatProgramLabel(selection.index)} -> ${peerLabel}`;
  traceToggleButton.textContent = traceRunning && !halted ? "pause" : "play";
  traceResetButton.disabled = false;
  renderTape(leftGridCells, tape, { offset: 0, pc, head0, head1 });
  renderTape(rightGridCells, tape, { offset: TAPE_SIZE, pc, head0, head1 });
}

function captureSelectionTrace() {
  if (!selection || !universe) {
    return false;
  }

  if (!syncSelectionPartnerState(true)) {
    return false;
  }

  freeInspector();
  inspector = universe.create_pair_inspector(selection.index, selection.partnerIndex);
  selection.snapshotEpoch = universe.epoch();
  inspectMode = "trace";
  renderInspector();
  return true;
}

function refreshSelectionAfterUniverseChange() {
  if (!selection || !universe) {
    return;
  }

  inspectMode = "live";
  if (!syncSelectionPartnerState(true)) {
    return;
  }
  renderInspector();
}

function selectProgram(programIndex) {
  if (!universe) {
    return;
  }

  const options = buildPartnerOptions(programIndex);
  if (options.length === 0) {
    clearSelection();
    return;
  }

  if (uiHidden) {
    setUiHidden(false);
  }
  setSettingsOpen(false);

  const partnerMode =
    selection?.index === programIndex &&
    options.some((option) => option.value === selection.partnerMode)
      ? selection.partnerMode
      : options[0].value;

  selection = {
    index: programIndex,
    partnerIndex: options[0].index,
    partnerMode,
    partnerOptions: options,
    partnerSignature: "",
    snapshotEpoch: universe.epoch(),
  };
  inspectMode = "live";
  viewNeedsDraw = true;
  syncSelectionPartnerState(true);
  renderInspector();
}

function handleCanvasTap(point) {
  const programIndex = getProgramIndexFromCanvasPoint(point);
  if (programIndex == null) {
    return;
  }

  selectProgram(programIndex);
}

function setCameraCenterFromAnchor(anchorWorld, screenX, screenY) {
  const scale = getEffectiveScale();
  camera.centerX = anchorWorld.x - (screenX - canvas.width / 2) / scale;
  camera.centerY = anchorWorld.y - (screenY - canvas.height / 2) / scale;
  clampCamera();
  updateCameraReadout();
  viewNeedsDraw = true;
}

function setCameraZoom(nextZoom, anchorX = canvas.width / 2, anchorY = canvas.height / 2) {
  if (!worldCanvas.width || !worldCanvas.height) {
    return;
  }

  const anchorWorld = screenToWorld(anchorX, anchorY);
  camera.zoom = clampNumber(nextZoom, camera.minZoom, camera.maxZoom);
  setCameraCenterFromAnchor(anchorWorld, anchorX, anchorY);
}

function beginPanGesture(pointerId) {
  const point = activePointers.get(pointerId);
  if (!point) {
    return;
  }

  gesture = {
    type: "pan",
    pointerId,
    anchorWorld: screenToWorld(point.x, point.y),
  };
  canvas.classList.add("is-grabbing");
}

function beginPinchGesture() {
  if (activePointers.size < 2) {
    return;
  }

  const [first, second] = [...activePointers.values()];
  const midpointX = (first.x + second.x) / 2;
  const midpointY = (first.y + second.y) / 2;

  gesture = {
    type: "pinch",
    anchorWorld: screenToWorld(midpointX, midpointY),
    startDistance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
    startZoom: camera.zoom,
  };
  canvas.classList.add("is-grabbing");
}

function endPointerGesture(pointerId) {
  activePointers.delete(pointerId);

  if (activePointers.size >= 2) {
    beginPinchGesture();
    return;
  }

  if (activePointers.size === 1) {
    const [nextPointerId] = activePointers.keys();
    beginPanGesture(nextPointerId);
    return;
  }

  gesture = null;
  canvas.classList.remove("is-grabbing");
}

function handlePointerMove(pointerId) {
  if (!gesture) {
    return;
  }

  if (gesture.type === "pan" && gesture.pointerId === pointerId) {
    const point = activePointers.get(pointerId);
    if (!point) {
      return;
    }
    setCameraCenterFromAnchor(gesture.anchorWorld, point.x, point.y);
    return;
  }

  if (gesture.type === "pinch" && activePointers.size >= 2) {
    const [first, second] = [...activePointers.values()];
    const midpointX = (first.x + second.x) / 2;
    const midpointY = (first.y + second.y) / 2;
    const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
    const nextZoom = gesture.startZoom * (distance / gesture.startDistance);
    camera.zoom = clampNumber(nextZoom, camera.minZoom, camera.maxZoom);
    setCameraCenterFromAnchor(gesture.anchorWorld, midpointX, midpointY);
  }
}

function nudgeCamera(xDirection, yDirection) {
  const scale = getEffectiveScale();
  const viewWidth = canvas.width / scale;
  const viewHeight = canvas.height / scale;
  camera.centerX += viewWidth * 0.12 * xDirection;
  camera.centerY += viewHeight * 0.12 * yDirection;
  clampCamera();
  updateCameraReadout();
  viewNeedsDraw = true;
}

function updateStats(now) {
  const epoch = universe.epoch();
  const elapsed = now - lastSampleTime;
  if (elapsed >= STATS_INTERVAL_MS) {
    currentThroughput = ((epoch - lastSampleEpoch) * 1000) / elapsed;
    lastSampleTime = now;
    lastSampleEpoch = epoch;
  }

  epochValue.textContent = epoch.toLocaleString();
  opcodeValue.textContent = `${universe.opcode_percent().toFixed(2)}%`;
  throughputValue.textContent = `${Math.round(currentThroughput).toLocaleString()} ep/s`;
  publishDebugSnapshot();
}

function applyRuntimeConfig(nextConfig, message) {
  currentConfig = nextConfig;
  syncInputsWithConfig(currentConfig);
  history.replaceState({}, "", buildConfigUrl(currentConfig).toString());
  resetSimulationPacing();
  if (message) {
    setStatus(composeStatus(message));
  } else {
    publishDebugSnapshot();
  }
}

function setSpeedMode(nextSpeedMode, message = null) {
  const normalized = normalizeSpeedMode(nextSpeedMode);
  if (normalized === currentConfig.speedMode) {
    speedValue.textContent = formatSpeedLabel(normalized);
    return;
  }

  applyRuntimeConfig(
    {
      ...currentConfig,
      speedMode: normalized,
    },
    message ?? `pace ${formatSpeedLabel(normalized)}.`,
  );
}

function stepSpeedMode(direction) {
  const currentIndex = SPEED_OPTIONS.indexOf(currentConfig.speedMode);
  const safeIndex = currentIndex >= 0 ? currentIndex : SPEED_OPTIONS.length - 1;
  const nextIndex = clampNumber(safeIndex + direction, 0, SPEED_OPTIONS.length - 1);
  setSpeedMode(SPEED_OPTIONS[nextIndex]);
}

function refreshEngineLabel() {
  const actualThreadCount = universe.thread_count();
  if (actualThreadCount > 1) {
    engineValue.textContent = `threaded x${actualThreadCount}`;
    engineStatus = `${actualThreadCount} rayon threads active.`;
    return;
  }

  engineValue.textContent = "single-core";
  if (currentForcedEngineMode === "single" || currentRequestedThreadCount === 1) {
    engineStatus = "single-core runtime active.";
    return;
  }

  engineStatus = "single-core runtime active. requested thread pool unavailable.";
}

function rebuildUniverse(message = "wasm live.") {
  freeInspector();
  if (universe) {
    universe.free();
  }

  universe = new wasmPkg.Universe(
    currentConfig.width,
    currentConfig.height,
    currentConfig.seed,
    currentConfig.mutationPercent / 100,
  );

  refreshEngineLabel();
  setupCanvas();
  resetSimulationPacing();
  lastSampleTime = performance.now();
  lastSampleEpoch = universe.epoch();
  lastStatsPaintTime = 0;
  currentThroughput = 0;
  presentNow(true);
  refreshSelectionAfterUniverseChange();
  setStatus(composeStatus(message));
}

async function simulationLoop() {
  while (true) {
    if (universe && running) {
      const speedMultiplier = getSpeedMultiplier();
      if (speedMultiplier == null) {
        const budgetStart = performance.now();
        do {
          universe.step_epochs(currentConfig.epochsPerFrame);
          frameNeedsUpload = true;
        } while (
          universe &&
          running &&
          performance.now() - budgetStart < SIMULATION_BUDGET_MS
        );

        resetSimulationPacing();
        await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }

      const now = performance.now();
      const elapsed = now - lastSimulationTime;
      lastSimulationTime = now;
      simulationAccumulator = Math.min(
        simulationAccumulator + elapsed * speedMultiplier,
        MAX_SIMULATION_ACCUMULATOR_MS,
      );

      let stepped = false;
      const budgetStart = now;
      while (
        universe &&
        running &&
        simulationAccumulator >= SPEED_STEP_COST_MS &&
        performance.now() - budgetStart < SIMULATION_BUDGET_MS
      ) {
        universe.step_epochs(currentConfig.epochsPerFrame);
        frameNeedsUpload = true;
        simulationAccumulator -= SPEED_STEP_COST_MS;
        stepped = true;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, stepped ? 0 : Math.max(4, SPEED_STEP_COST_MS / 4)),
      );
      continue;
    }

    resetSimulationPacing();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function tick(now) {
  if (selection && inspectMode === "live") {
    renderInspector();
  }

  if (universe && (frameNeedsUpload || viewNeedsDraw) && now - lastPresentTime >= PRESENT_INTERVAL_MS) {
    presentNow(false);
  }

  if (universe && now - lastStatsPaintTime >= STATS_INTERVAL_MS) {
    updateStats(now);
    lastStatsPaintTime = now;
  }

  if (traceRunning && inspector) {
    let advanced = false;
    for (
      let stepIndex = 0;
      stepIndex < TRACE_PLAY_STEPS_PER_FRAME && !inspector.halted();
      stepIndex += 1
    ) {
      advanced = inspector.step() || advanced;
    }

    if (advanced || inspector.halted()) {
      renderInspector();
    }
    if (inspector.halted()) {
      traceRunning = false;
      traceToggleButton.textContent = "play";
    }
  }

  requestAnimationFrame(tick);
}

function applyLiveConfig(nextConfig, message) {
  currentConfig = nextConfig;
  syncInputsWithConfig(currentConfig);
  history.replaceState({}, "", buildConfigUrl(currentConfig).toString());
  rebuildUniverse(message);
}

function applyConfig(message) {
  const nextConfig = readConfigFromInputs();
  const configError = validateConfig(nextConfig);
  if (configError) {
    setStatus(configError);
    return;
  }
  const nextThreadSetting = normalizeThreadSetting(nextConfig.threadSetting);
  const currentThreadSetting = getThreadSelectionFromUrl();
  const nextUrl = buildNavigationUrl(nextConfig);
  const requiresTransportChange =
    normalizeThreadSetting(nextConfig.threadSetting) !== "1" &&
    window.location.protocol !== nextUrl.protocol;

  if (nextThreadSetting !== currentThreadSetting || requiresTransportChange) {
    setRunning(false);
    statePill.textContent = "reload";
    setStatus("reloading to apply thread settings...");
    window.location.assign(nextUrl.toString());
    return;
  }

  applyLiveConfig(nextConfig, message);
  setSettingsOpen(false);
}

function applyPreset(patch, message) {
  const nextConfig = {
    ...readConfigFromInputs(),
    ...patch,
  };
  syncInputsWithConfig(nextConfig);
  applyConfig(message);
}

function isFormTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.closest("input, select, textarea, button") !== null || target.isContentEditable)
  );
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  applyConfig("settings applied.");
});

toggleButton.addEventListener("click", () => {
  setRunning(!running);
  setStatus(
    composeStatus(
      running ? "streaming live." : "paused. use step for a single epoch.",
    ),
  );
});

stepButton.addEventListener("click", () => {
  if (!universe) {
    return;
  }

  resetSimulationPacing();
  universe.step_epochs(1);
  frameNeedsUpload = true;
  presentNow(true);
  if (selection && inspectMode === "live") {
    renderInspector();
  }
  setStatus(composeStatus("advanced one epoch."));
});

quickResetButton.addEventListener("click", () => {
  applyLiveConfig({ ...currentConfig }, "universe reset.");
});

settingsButton.addEventListener("click", () => {
  setSettingsOpen(!settingsOpen);
});

hideUiButton.addEventListener("click", () => {
  setUiHidden(true);
});

inspectCloseButton.addEventListener("click", () => {
  clearSelection();
});

inspectCaptureButton.addEventListener("click", () => {
  captureSelectionTrace();
});

traceStepButton.addEventListener("click", () => {
  if (!inspector && !captureSelectionTrace()) {
    return;
  }

  traceRunning = false;
  if (inspector.halted()) {
    inspector.reset();
  }
  inspector.step();
  renderInspector();
});

traceResetButton.addEventListener("click", () => {
  if (!selection) {
    return;
  }

  freeInspector();
  inspectMode = "live";
  renderInspector();
});

traceToggleButton.addEventListener("click", () => {
  if (!inspector && !captureSelectionTrace()) {
    return;
  }

  if (inspector.halted()) {
    inspector.reset();
  }

  traceRunning = !traceRunning;
  traceToggleButton.textContent = traceRunning ? "pause" : "play";
  renderInspector();
});

inspectPeerSelect.addEventListener("change", () => {
  if (!selection) {
    return;
  }

  selection.partnerMode = inspectPeerSelect.value;
  if (inspectMode === "trace") {
    captureSelectionTrace();
    return;
  }

  renderInspector();
});

speedSelect.addEventListener("change", () => {
  setSpeedMode(speedSelect.value);
});

speedDownButton.addEventListener("click", () => {
  stepSpeedMode(-1);
});

speedUpButton.addEventListener("click", () => {
  stepSpeedMode(1);
});

fastPresetButton.addEventListener("click", () => {
  applyPreset(
    {
      width: FAST_GRID.width,
      height: FAST_GRID.height,
      epochsPerFrame: 4,
    },
    "fast preset applied.",
  );
});

originalPresetButton.addEventListener("click", () => {
  applyPreset(
    {
      width: ORIGINAL_GRID.width,
      height: ORIGINAL_GRID.height,
      epochsPerFrame: 1,
    },
    "original preset applied.",
  );
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  canvas.focus({ preventScroll: true });
  const point = clientToCanvasPoint(event.clientX, event.clientY);
  activePointers.set(event.pointerId, {
    x: point.x,
    y: point.y,
    startX: point.x,
    startY: point.y,
    moved: false,
  });
  canvas.setPointerCapture(event.pointerId);

  if (activePointers.size >= 2) {
    beginPinchGesture();
  } else {
    beginPanGesture(event.pointerId);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) {
    return;
  }

  const nextPoint = clientToCanvasPoint(event.clientX, event.clientY);
  const pointer = activePointers.get(event.pointerId);
  pointer.x = nextPoint.x;
  pointer.y = nextPoint.y;
  if (
    Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >
    POINTER_TAP_THRESHOLD
  ) {
    pointer.moved = true;
  }
  handlePointerMove(event.pointerId);
});

function releasePointer(event) {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) {
    return;
  }

  const wasTap =
    activePointers.size === 1 &&
    gesture?.type !== "pinch" &&
    pointer.moved === false;

  endPointerGesture(event.pointerId);
  if (wasTap) {
    handleCanvasTap(pointer);
  }
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", releasePointer);

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const point = clientToCanvasPoint(event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0015);
    setCameraZoom(camera.zoom * factor, point.x, point.y);
  },
  { passive: false },
);

canvas.addEventListener("dblclick", () => {
  resetCamera();
});

window.addEventListener("resize", () => {
  resizeDisplayCanvas();
  presentNow(false);
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const formTarget = isFormTarget(event.target);

  if (!event.metaKey && !event.ctrlKey && !event.altKey && key === "h" && !formTarget) {
    event.preventDefault();
    setUiHidden(!uiHidden);
    return;
  }

  if (key === "escape" && settingsOpen) {
    event.preventDefault();
    setSettingsOpen(false);
    return;
  }

  if (key === "escape" && selection) {
    event.preventDefault();
    clearSelection();
    return;
  }

  if (formTarget) {
    return;
  }

  switch (key) {
    case "+":
    case "=":
      event.preventDefault();
      setCameraZoom(camera.zoom * 1.18);
      break;
    case "-":
    case "_":
      event.preventDefault();
      setCameraZoom(camera.zoom / 1.18);
      break;
    case "0":
      event.preventDefault();
      resetCamera();
      break;
    case "arrowleft":
      event.preventDefault();
      nudgeCamera(-1, 0);
      break;
    case "arrowright":
      event.preventDefault();
      nudgeCamera(1, 0);
      break;
    case "arrowup":
      event.preventDefault();
      nudgeCamera(0, -1);
      break;
    case "arrowdown":
      event.preventDefault();
      nudgeCamera(0, 1);
      break;
    case "[":
    case "{":
      event.preventDefault();
      stepSpeedMode(-1);
      break;
    case "]":
    case "}":
      event.preventDefault();
      stepSpeedMode(1);
      break;
    default:
      break;
  }
});

async function boot() {
  try {
    currentConfig = readConfigFromUrl();
    syncInputsWithConfig(currentConfig);
    updateCameraReadout();
    setSettingsOpen(false);
    setUiHidden(false);
    updateSurfaceHints();

    await loadWasmPackage();
    setRunning(true);
    rebuildUniverse("drag to pan. wheel to zoom.");
    simulationLoop();
    requestAnimationFrame(tick);
    publishDebugSnapshot();
  } catch (error) {
    console.error(error);
    setRunning(false);
    statePill.textContent = "error";
    engineValue.textContent = "offline";
    setStatus(`startup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

boot();
