const docList = document.getElementById("docList");
const docContent = document.getElementById("docContent");
const mobileMenuButton = document.getElementById("mobileMenuButton");
const sidebarCloseButton = document.getElementById("sidebarCloseButton");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const fullscreenModal = document.getElementById("fullscreenModal");
const fullscreenMount = document.getElementById("fullscreenMount");
const fullscreenCloseButton = document.getElementById("fullscreenCloseButton");
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authPasswordInput = document.getElementById("authPasswordInput");
const authError = document.getElementById("authError");

const STORAGE_KEYS = {
  env: "doccurl.env",
  legacyAppUrl: "doccurl.app_url",
  legacyToken: "doccurl.token",
};

const playgroundStates = new Map();
const expandedDirs = new Set();
let playgroundCounter = 0;
let envInputs = [];
let envToolbarState = { fieldsContainer: null, suggestedNames: [] };
let fullscreenState = null;
let authEnabled = false;
let docsTree = [];
let currentDocPath = "";

function inferBasePathFromPathname(pathname) {
  // Remove query/hash if present, then work only with the path portion.
  const cleanPath = String(pathname || "/").split(/[?#]/, 1)[0];

  // Remove trailing slashes: "/Z/docs/" => "/Z/docs"
  // Regex: \/+$ matches one or more slashes at the end
  const normalized = cleanPath.replace(/\/+$/, "") || "/";

  // Root path ("/") => no base prefix needed.
  if (normalized === "/") {
    return "";
  }

  // Use the entire current path as base without modification.
  // Examples: "/docs" => "/docs", "/Z/docs" => "/Z/docs"
  return normalized;
}

// Auto-detect base path from current URL pathname.
// For CLI usage with Nginx proxy (e.g., Y.com/Z/docs), this automatically
// detects the mount prefix and routes API calls correctly.
const docsBasePath = inferBasePathFromPathname(window.location.pathname);

function withBasePath(path) {
  // Regex /^\/+/: strip any leading slashes from input path,
  // then prepend a single slash for consistent joining.
  const normalizedPath = `/${String(path || "").replace(/^\/+/, "")}`;

  // If docsBasePath is "", result is "/api/...".
  // If docsBasePath is "/docs", result is "/docs/api/...".
  return `${docsBasePath}${normalizedPath}`;
}

function createUnauthorizedError() {
  const error = new Error("Unauthorized");
  error.code = "UNAUTHORIZED";
  return error;
}

function setSidebarOpen(isOpen) {
  document.body.classList.toggle("sidebar-open", isOpen);
}

function closeSidebar() {
  setSidebarOpen(false);
}

function openSidebar() {
  setSidebarOpen(true);
}

function showAuthModal(message = "") {
  if (!authModal) {
    return;
  }
  authModal.hidden = false;
  authModal.classList.add("is-open");
  document.body.classList.add("auth-locked");
  if (authError) {
    authError.textContent = message;
  }
  if (authPasswordInput) {
    authPasswordInput.value = "";
    requestAnimationFrame(() => authPasswordInput.focus());
  }
}

function hideAuthModal() {
  if (!authModal) {
    return;
  }
  authModal.classList.remove("is-open");
  authModal.hidden = true;
  document.body.classList.remove("auth-locked");
  if (authError) {
    authError.textContent = "";
  }
}

function handleUnauthorized() {
  showAuthModal("Session expired. Enter password to continue.");
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function apiFetch(url, options = {}, { allowUnauthorized = false } = {}) {
  const response = await fetch(url, options);

  if (
    authEnabled &&
    !allowUnauthorized &&
    (response.status === 401 || response.status === 403)
  ) {
    handleUnauthorized();
    throw createUnauthorizedError();
  }

  return response;
}

async function fetchAuthStatus() {
  const response = await fetch(withBasePath("/api/auth/status"));
  if (!response.ok) {
    throw new Error("Failed to load auth status");
  }
  return parseJsonSafe(response);
}

function loadStoredEnv() {
  const legacyEnv = {};
  const legacyAppUrl = localStorage.getItem(STORAGE_KEYS.legacyAppUrl);
  const legacyToken = localStorage.getItem(STORAGE_KEYS.legacyToken);

  if (legacyAppUrl !== null) {
    legacyEnv.APP_URL = legacyAppUrl;
  }
  if (legacyToken !== null) {
    legacyEnv.TOKEN = legacyToken;
  }

  const rawValue = localStorage.getItem(STORAGE_KEYS.env);
  if (!rawValue) {
    return legacyEnv;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return legacyEnv;
    }

    const normalized = {};
    for (const [name, value] of Object.entries(parsed)) {
      const normalizedName = normalizeEnvName(name);
      if (!normalizedName) {
        continue;
      }
      normalized[normalizedName] = String(value ?? "");
    }

    return { ...legacyEnv, ...normalized };
  } catch {
    return legacyEnv;
  }
}

function getCurrentEnv() {
  if (envInputs.length > 0) {
    const nextEnv = {};
    envInputs.forEach(({ nameInput, valueInput }) => {
      const name = normalizeEnvName(nameInput.value);
      if (!name) {
        return;
      }
      nextEnv[name] = valueInput.value.trim();
    });
    return nextEnv;
  }
  return loadStoredEnv();
}

function persistEnv(values) {
  localStorage.setItem(STORAGE_KEYS.env, JSON.stringify(values));
  localStorage.removeItem(STORAGE_KEYS.legacyAppUrl);
  localStorage.removeItem(STORAGE_KEYS.legacyToken);
}

function normalizeEnvName(name) {
  return String(name || "").trim().replace(/^\$/, "");
}

function extractPlaceholderNames(text) {
  const names = new Set();
  String(text || "").replace(/\$([A-Za-z_][A-Za-z0-9_]*)\b/g, (_match, name) => {
    names.add(name);
    return _match;
  });
  return Array.from(names);
}

function collectPlaceholderNamesFromDocument(container = docContent) {
  const names = new Set();
  container.querySelectorAll("pre code.language-curl").forEach((block) => {
    extractPlaceholderNames(block.textContent).forEach((name) => names.add(name));
  });
  return Array.from(names);
}

function shouldMaskEnvValue(name) {
  return /token|secret|password|key/i.test(name);
}

function updateEnvValueInputType(nameInput, valueInput) {
  valueInput.type = shouldMaskEnvValue(nameInput.value) ? "password" : "text";
}

function persistCurrentEnv() {
  persistEnv(getCurrentEnv());
}

function createEnvField(name = "", value = "") {
  const row = document.createElement("div");
  row.className = "envFieldRow";

  const nameField = document.createElement("div");
  nameField.className = "envField";

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Variable";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "envNameInput";
  nameInput.placeholder = "APP_URL";
  nameInput.setAttribute("aria-label", "Environment variable name");
  nameInput.value = name;

  nameField.append(nameLabel, nameInput);

  const valueField = document.createElement("div");
  valueField.className = "envField";

  const valueLabel = document.createElement("label");
  valueLabel.textContent = "Value";

  const valueInput = document.createElement("input");
  valueInput.className = "envValueInput";
  valueInput.placeholder = "Environment variable value";
  valueInput.setAttribute("aria-label", "Environment variable value");
  valueInput.value = value;
  updateEnvValueInputType(nameInput, valueInput);

  valueField.append(valueLabel, valueInput);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "removeEnvBtn";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", `Remove ${name || "environment variable"}`);

  const inputState = { row, nameInput, valueInput, removeButton };
  envInputs.push(inputState);

  const handleInput = () => {
    updateEnvValueInputType(nameInput, valueInput);
    removeButton.setAttribute(
      "aria-label",
      `Remove ${normalizeEnvName(nameInput.value) || "environment variable"}`,
    );
    persistCurrentEnv();
  };

  nameInput.addEventListener("input", handleInput);
  valueInput.addEventListener("input", handleInput);
  removeButton.addEventListener("click", () => {
    envInputs = envInputs.filter((entry) => entry !== inputState);
    row.remove();
    persistCurrentEnv();
  });

  row.append(nameField, valueField, removeButton);
  return row;
}

function renderEnvFields(values = loadStoredEnv(), suggestedNames = []) {
  if (!envToolbarState.fieldsContainer) {
    return;
  }

  envToolbarState.fieldsContainer.innerHTML = "";
  envInputs = [];

  const orderedNames = Array.from(
    new Set([
      ...suggestedNames.map(normalizeEnvName).filter(Boolean),
      ...Object.keys(values).map(normalizeEnvName).filter(Boolean),
    ]),
  );

  if (orderedNames.length === 0) {
    orderedNames.push("");
  }

  orderedNames.forEach((name) => {
    envToolbarState.fieldsContainer.appendChild(
      createEnvField(name, Object.prototype.hasOwnProperty.call(values, name) ? values[name] : ""),
    );
  });
}

function tokenizeShell(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (escaping) {
      if (ch !== "\n") {
        current += ch;
      }
      escaping = false;
      continue;
    }

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "\\") {
        const next = input[i + 1];
        if (
          next === '"' ||
          next === "\\" ||
          next === "$" ||
          next === "`" ||
          next === "\n"
        ) {
          escaping = true;
          continue;
        }
      }
      current += ch;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function quoteDouble(value) {
  return `"${String(value).replace(/["\\]/g, "\\$&")}"`;
}

function quoteSinglePreferred(value) {
  const stringValue = String(value);
  if (!stringValue.includes("'")) {
    return `'${stringValue}'`;
  }
  return quoteDouble(stringValue);
}

function quoteGenericToken(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:$?&=%@-]+$/.test(stringValue)) {
    return stringValue;
  }
  return quoteDouble(stringValue);
}

function normalizeJsonData(dataToken) {
  try {
    const parsed = JSON.parse(String(dataToken));
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function formatDataLines(dataToken) {
  const prettyJson = normalizeJsonData(dataToken);
  if (!prettyJson) {
    return [`  -d ${quoteSinglePreferred(dataToken)} \\`];
  }

  const jsonLines = prettyJson.split("\n");
  if (jsonLines.length === 1) {
    return [`  -d '${jsonLines[0]}' \\`];
  }

  const lines = [];
  lines.push(`  -d '${jsonLines[0]}`);
  for (let i = 1; i < jsonLines.length; i += 1) {
    const isLast = i === jsonLines.length - 1;
    lines.push(`  ${jsonLines[i]}${isLast ? "' \\" : ""}`);
  }
  return lines;
}

function formatCurlCommand(command) {
  const cleaned = String(command || "")
    .replace(/\\\r?\n\s*/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  let tokens;
  try {
    tokens = tokenizeShell(cleaned);
  } catch {
    return cleaned;
  }

  if (!tokens.length || tokens[0] !== "curl") {
    return cleaned;
  }

  let method = "";
  let url = "";
  const headers = [];
  const dataEntries = [];
  const passthrough = [];

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === "-X" || token === "--request") {
      method = tokens[i + 1] || method;
      i += 1;
      continue;
    }
    if (token.startsWith("--request=")) {
      method = token.slice("--request=".length) || method;
      continue;
    }
    if (token.startsWith("-X") && token.length > 2) {
      method = token.slice(2) || method;
      continue;
    }

    if (token === "--url") {
      url = tokens[i + 1] || url;
      i += 1;
      continue;
    }
    if (token.startsWith("--url=")) {
      url = token.slice("--url=".length) || url;
      continue;
    }

    if (token === "-H" || token === "--header") {
      headers.push(tokens[i + 1] || "");
      i += 1;
      continue;
    }
    if (token.startsWith("--header=")) {
      headers.push(token.slice("--header=".length));
      continue;
    }

    if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary" ||
      token === "--data-urlencode"
    ) {
      dataEntries.push(tokens[i + 1] || "");
      i += 1;
      continue;
    }

    if (
      token.startsWith("--data=") ||
      token.startsWith("--data-raw=") ||
      token.startsWith("--data-binary=") ||
      token.startsWith("--data-urlencode=")
    ) {
      dataEntries.push(token.slice(token.indexOf("=") + 1));
      continue;
    }

    if (!url && !token.startsWith("-")) {
      url = token;
      continue;
    }

    passthrough.push(token);
  }

  if (!method) {
    method = dataEntries.length > 0 ? "POST" : "GET";
  }

  const lines = ["curl \\"];
  lines.push(`  -X ${method.toUpperCase()} \\`);

  if (url) {
    lines.push(`  ${quoteDouble(url)} \\`);
  }

  for (const header of headers) {
    lines.push(`  -H ${quoteDouble(header)} \\`);
  }

  for (const dataEntry of dataEntries) {
    lines.push(...formatDataLines(dataEntry));
  }

  for (const extra of passthrough) {
    lines.push(`  ${quoteGenericToken(extra)} \\`);
  }

  if (lines.length === 1) {
    return "curl";
  }

  lines[lines.length - 1] = lines[lines.length - 1].replace(/\s\\$/, "");
  return lines.join("\n");
}

function replacePlaceholders(text, env) {
  return String(text || "").replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)\b/g,
    (match, name) =>
      Object.prototype.hasOwnProperty.call(env, name) ? env[name] : match,
  );
}

function highlightCodeElement(codeElement, language = "plaintext") {
  if (!window.hljs) {
    return;
  }
  codeElement.className = `language-${language}`;
  window.hljs.highlightElement(codeElement);
}

function prettifyTextareaCommand(state) {
  const formatted = formatCurlCommand(state.editorElement.value || "");
  if (formatted) {
    state.editorElement.value = formatted;
  }
}

function syncCurlOverlay(state, { highlight = true } = {}) {
  const raw = state.editorElement.value || "";
  state.overlayCode.textContent = raw.endsWith("\n") ? `${raw} ` : raw;
  if (highlight && window.hljs) {
    highlightCodeElement(state.overlayCode, "bash");
    state.editorShell.classList.add("overlay-active");
  } else {
    state.editorShell.classList.remove("overlay-active");
  }
}

function syncCurlOverlayScroll(state) {
  state.overlayElement.scrollTop = state.editorElement.scrollTop;
  state.overlayElement.scrollLeft = state.editorElement.scrollLeft;
}

function prettifyMarkup(input) {
  const text = String(input || "").trim();
  if (!text) {
    return text;
  }

  const tokenized = text.replace(/>\s*</g, ">\n<").split("\n");
  const lines = [];
  let indent = 0;

  for (const raw of tokenized) {
    const token = raw.trim();
    if (!token) {
      continue;
    }

    const isClosing = /^<\//.test(token);
    const isComment = /^<!--/.test(token);
    const isDeclaration = /^<\?/.test(token) || /^<!/.test(token);
    const isSelfClosing = /\/>$/.test(token) || isComment || isDeclaration;
    const hasOpening = /^<[^/!?\s][^>]*>$/.test(token);

    if (isClosing) {
      indent = Math.max(0, indent - 1);
    }

    lines.push(`${"  ".repeat(indent)}${token}`);

    if (hasOpening && !isSelfClosing && !token.includes("</")) {
      indent += 1;
    }
  }

  return lines.join("\n");
}

function showOutputMessage(outputElement, message, isError = false) {
  outputElement.innerHTML = "";
  const preElement = document.createElement("pre");
  const codeElement = document.createElement("code");
  codeElement.textContent = message;
  codeElement.className = "language-plaintext";
  if (isError) {
    codeElement.classList.add("outputError");
  }
  preElement.appendChild(codeElement);
  outputElement.appendChild(preElement);
  highlightCodeElement(codeElement, "plaintext");
}

function renderLoading(outputElement) {
  outputElement.innerHTML = '<div class="outputEmpty">Running...</div>';
}

function renderEmpty(outputElement) {
  outputElement.innerHTML =
    '<div class="outputEmpty">Run a request to see the response</div>';
}

function renderResponseOutput(outputElement, rawText, isError = false) {
  const output = String(rawText || "").trim();
  if (!output) {
    renderEmpty(outputElement);
    return;
  }

  let language = "plaintext";
  let displayText = output;

  try {
    const parsed = JSON.parse(output);
    displayText = JSON.stringify(parsed, null, 2);
    language = "json";
  } catch {
    if (output.match(/^\s*<(!DOCTYPE\s+html|html|!--)/i)) {
      language = "html";
      displayText = prettifyMarkup(output);
    } else if (output.match(/^\s*<\?xml/i)) {
      language = "xml";
      displayText = prettifyMarkup(output);
    } else if (output.startsWith("<") && output.endsWith(">")) {
      language = "xml";
      displayText = prettifyMarkup(output);
    }
  }

  outputElement.innerHTML = "";
  const preElement = document.createElement("pre");
  const codeElement = document.createElement("code");
  codeElement.textContent = displayText;
  codeElement.className = `language-${language}`;
  if (isError) {
    codeElement.classList.add("outputError");
  }
  preElement.appendChild(codeElement);
  outputElement.appendChild(preElement);

  highlightCodeElement(codeElement, language);
  if (window.hljs && window.hljs.lineNumbersBlock) {
    try {
      window.hljs.lineNumbersBlock(codeElement);
    } catch (_err) {
      // Line numbers can fail for some inputs; keep response visible.
    }
  }
}

async function runCurlCommand(command, outputElement) {
  renderLoading(outputElement);
  try {
    const response = await apiFetch(withBasePath("/api/run-curl"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });

    const data = await parseJsonSafe(response);

    if (response.ok && data.success) {
      renderResponseOutput(outputElement, data.output);
      return;
    }

    const errorText = data.error || data.details || "Request failed";
    renderResponseOutput(outputElement, `Error: ${errorText}`, true);
  } catch (error) {
    if (error.code === "UNAUTHORIZED") {
      showOutputMessage(
        outputElement,
        "Error: Unauthorized. Enter password to continue.",
        true,
      );
      return;
    }
    showOutputMessage(outputElement, `Error: ${error.message}`, true);
  }
}

function openFullscreen(playgroundElement) {
  if (fullscreenState) {
    closeFullscreen();
  }

  const placeholder = document.createElement("div");
  placeholder.className = "fullscreenPlaceholder";
  playgroundElement.after(placeholder);
  fullscreenMount.appendChild(playgroundElement);

  fullscreenState = { playgroundElement, placeholder };
  fullscreenModal.hidden = false;
  document.body.classList.add("fullscreen-open");
}

function closeFullscreen() {
  if (!fullscreenState) {
    return;
  }

  const { playgroundElement, placeholder } = fullscreenState;
  if (placeholder.isConnected) {
    placeholder.replaceWith(playgroundElement);
  }
  fullscreenState = null;
  fullscreenModal.hidden = true;
  document.body.classList.remove("fullscreen-open");
}

function createEnvToolbar(suggestedNames = []) {
  const envValues = loadStoredEnv();
  const toolbar = document.createElement("div");
  toolbar.className = "docEnvBar";
  const hint = document.createElement("div");
  hint.className = "envToolbarHint";
  hint.textContent =
    "Add environment variables to replace matching $VARIABLE placeholders before running curl commands.";

  const fieldsContainer = document.createElement("div");
  fieldsContainer.className = "envFieldList";

  const actions = document.createElement("div");
  actions.className = "envActions";

  const addButton = document.createElement("button");
  addButton.id = "doccurl-add-env";
  addButton.className = "secondaryBtn";
  addButton.type = "button";
  addButton.textContent = "Add variable";

  const resetButton = document.createElement("button");
  resetButton.id = "doccurl-reset-all";
  resetButton.className = "resetBtn";
  resetButton.type = "button";
  resetButton.textContent = "Clear all changes";

  actions.append(addButton, resetButton);
  toolbar.append(hint, fieldsContainer, actions);

  envToolbarState = {
    fieldsContainer,
    suggestedNames: Array.from(new Set(suggestedNames.map(normalizeEnvName).filter(Boolean))),
  };
  renderEnvFields(envValues, envToolbarState.suggestedNames);

  addButton.addEventListener("click", () => {
    const row = createEnvField();
    envToolbarState.fieldsContainer.appendChild(row);
    persistCurrentEnv();
  });

  resetButton.addEventListener("click", resetDocSession);

  return toolbar;
}

function createPlayground(curlCommand) {
  const playgroundId = `playground-${playgroundCounter}`;
  playgroundCounter += 1;

  const playground = document.createElement("div");
  playground.className = "curlPlaygroundInline";
  playground.dataset.playgroundId = playgroundId;
  playground.innerHTML = `
    <section class="playgroundPane">
      <div class="panelHeader">Request</div>
      <div class="curlScriptWrapper">
        <div class="curlEditorShell">
          <pre class="curlOverlay"><code class="language-bash"></code></pre>
          <textarea class="curlEditor" spellcheck="false" aria-label="Curl request editor"></textarea>
        </div>
      </div>
      <div class="panelActions">
        <button type="button" class="runBtn">Run</button>
      </div>
    </section>
    <section class="playgroundPane">
      <div class="panelHeader">Response</div>
      <div class="curlOutput">
        <div class="outputEmpty">Run a request to see the response</div>
      </div>
      <div class="panelActions">
        <button type="button" class="fullscreenBtn">Fullscreen</button>
      </div>
    </section>
  `;

  const editorElement = playground.querySelector(".curlEditor");
  const editorShell = playground.querySelector(".curlEditorShell");
  const overlayElement = playground.querySelector(".curlOverlay");
  const overlayCode = overlayElement.querySelector("code");
  const outputElement = playground.querySelector(".curlOutput");
  const runButton = playground.querySelector(".runBtn");
  const fullscreenButton = playground.querySelector(".fullscreenBtn");

  const originalTemplate = formatCurlCommand(curlCommand);
  editorElement.value = originalTemplate;

  const state = {
    playgroundElement: playground,
    editorElement,
    editorShell,
    overlayElement,
    overlayCode,
    outputElement,
    runButton,
    fullscreenButton,
    originalTemplate,
  };
  playgroundStates.set(playgroundId, state);

  syncCurlOverlay(state, { highlight: true });
  syncCurlOverlayScroll(state);

  editorElement.addEventListener("input", () => {
    syncCurlOverlay(state, { highlight: true });
    syncCurlOverlayScroll(state);
  });

  editorElement.addEventListener("scroll", () => {
    syncCurlOverlayScroll(state);
  });

  editorElement.addEventListener("blur", () => {
    prettifyTextareaCommand(state);
    syncCurlOverlay(state, { highlight: true });
    syncCurlOverlayScroll(state);
  });

  runButton.addEventListener("click", async () => {
    const env = getCurrentEnv();
    const visibleCommand = editorElement.value || "";
    const resolvedCommand = replacePlaceholders(visibleCommand, env);
    await runCurlCommand(resolvedCommand, outputElement);
  });

  fullscreenButton.addEventListener("click", () => {
    openFullscreen(playground);
  });

  return playground;
}

function resetDocSession() {
  if (fullscreenState) {
    closeFullscreen();
  }

  persistEnv({});
  renderEnvFields({}, envToolbarState.suggestedNames);

  for (const state of playgroundStates.values()) {
    state.editorElement.value = state.originalTemplate;
    syncCurlOverlay(state, { highlight: true });
    syncCurlOverlayScroll(state);
    renderEmpty(state.outputElement);
  }
}

function initializeCurlPlaygrounds() {
  playgroundStates.clear();
  const codeBlocks = docContent.querySelectorAll("pre code.language-curl");

  codeBlocks.forEach((block) => {
    const curlCommand = block.textContent.trim();
    const preElement = block.parentElement;
    const playground = createPlayground(curlCommand);
    preElement.replaceWith(playground);
  });
}

function expandPathAncestors(filePath) {
  const parts = filePath.split("/");
  let cursor = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor = cursor ? `${cursor}/${parts[i]}` : parts[i];
    expandedDirs.add(cursor);
  }
}

function findFirstFilePath(nodes) {
  for (const node of nodes) {
    if (node.type === "file") {
      return node.path;
    }
    if (node.type === "dir") {
      const nested = findFirstFilePath(node.children || []);
      if (nested) {
        return nested;
      }
    }
  }
  return "";
}

function docPathExists(nodes, pathValue) {
  for (const node of nodes) {
    if (node.type === "file" && node.path === pathValue) {
      return true;
    }
    if (node.type === "dir" && docPathExists(node.children || [], pathValue)) {
      return true;
    }
  }
  return false;
}

function renderTreeNodes(nodes, container, depth = 0) {
  nodes.forEach((node) => {
    const item = document.createElement("li");
    item.className = "docTreeItem";

    if (node.type === "dir") {
      const expanded = expandedDirs.has(node.path);
      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "docTreeToggle";
      toggleButton.style.paddingLeft = `${13 + depth * 18}px`;
      toggleButton.innerHTML = `
        <span class="docTreeCaret">${expanded ? "▾" : "▸"}</span>
        <span class="docTreeLabel">${node.name}</span>
      `;

      if (currentDocPath && currentDocPath.startsWith(`${node.path}/`)) {
        toggleButton.classList.add("active");
      }

      toggleButton.addEventListener("click", () => {
        if (expandedDirs.has(node.path)) {
          expandedDirs.delete(node.path);
        } else {
          expandedDirs.add(node.path);
        }
        renderDocTree();
      });

      item.appendChild(toggleButton);

      if (expanded) {
        const childrenList = document.createElement("ul");
        childrenList.className = "docTreeChildren";
        renderTreeNodes(node.children || [], childrenList, depth + 1);
        item.appendChild(childrenList);
      }

      container.appendChild(item);
      return;
    }

    if (node.type === "file") {
      const fileButton = document.createElement("button");
      fileButton.type = "button";
      fileButton.className = "docListButton docTreeFileButton";
      fileButton.style.paddingLeft = `${13 + depth * 18}px`;
      fileButton.dataset.path = node.path;
      fileButton.textContent = node.name.replace(/\.md$/, "");

      if (currentDocPath === node.path) {
        fileButton.classList.add("active");
      }

      fileButton.addEventListener("click", () => {
        expandPathAncestors(node.path);
        loadDoc(node.path);
      });

      item.appendChild(fileButton);
      container.appendChild(item);
    }
  });
}

function renderDocTree() {
  docList.innerHTML = "";

  const root = document.createElement("ul");
  root.className = "docTreeRoot";
  renderTreeNodes(docsTree, root, 0);
  docList.appendChild(root);
}

async function loadDoc(docPath) {
  if (fullscreenState) {
    closeFullscreen();
  }

  currentDocPath = docPath;
  renderDocTree();
  docContent.innerHTML = '<div class="loading">Loading document...</div>';

  try {
    const response = await apiFetch(
      withBasePath(`/api/docs/content?path=${encodeURIComponent(docPath)}`),
    );

    if (!response.ok) {
      const data = await parseJsonSafe(response);
      docContent.innerHTML = `<p class="errorText">Error: ${data.error || "Unable to load document"}</p>`;
      return;
    }

    const data = await parseJsonSafe(response);
    docContent.innerHTML = data.html || "";
    const placeholderNames = collectPlaceholderNamesFromDocument(docContent);
    docContent.prepend(createEnvToolbar(placeholderNames));
    initializeCurlPlaygrounds();

    if (window.matchMedia("(max-width: 960px)").matches) {
      closeSidebar();
    }
  } catch (error) {
    if (error.code === "UNAUTHORIZED") {
      docContent.innerHTML =
        '<p class="errorText">Authentication required.</p>';
      return;
    }

    docContent.innerHTML =
      '<p class="errorText">Error loading document. Please try again.</p>';
    console.error("Error loading document:", error);
  }
}

async function loadDocsTree() {
  try {
    const response = await apiFetch(withBasePath("/api/docs/tree"));

    if (!response.ok) {
      const data = await parseJsonSafe(response);
      docList.innerHTML = `<li class="errorText">${data.error || "Error loading docs tree"}</li>`;
      return;
    }

    const data = await parseJsonSafe(response);
    docsTree = Array.isArray(data.tree) ? data.tree : [];

    renderDocTree();

    if (docsTree.length === 0) {
      docContent.innerHTML = '<p class="errorText">No markdown docs found.</p>';
      return;
    }

    if (currentDocPath && docPathExists(docsTree, currentDocPath)) {
      expandPathAncestors(currentDocPath);
      renderDocTree();
      await loadDoc(currentDocPath);
      return;
    }

    const firstFilePath = findFirstFilePath(docsTree);
    if (firstFilePath) {
      expandPathAncestors(firstFilePath);
      renderDocTree();
      await loadDoc(firstFilePath);
    } else {
      docContent.innerHTML = '<p class="errorText">No markdown docs found.</p>';
    }
  } catch (error) {
    if (error.code === "UNAUTHORIZED") {
      return;
    }

    docList.innerHTML = '<li class="errorText">Error loading docs tree</li>';
    console.error("Error loading docs tree:", error);
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const password = authPasswordInput ? authPasswordInput.value : "";

  try {
    const response = await apiFetch(
      withBasePath("/api/auth/login"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      },
      { allowUnauthorized: true },
    );

    const data = await parseJsonSafe(response);
    if (!response.ok) {
      if (authError) {
        authError.textContent = data.error || "Invalid password";
      }
      return;
    }

    hideAuthModal();
    await loadDocsTree();
  } catch (error) {
    if (authError) {
      authError.textContent = "Unable to verify password. Try again.";
    }
    console.error("Authentication error:", error);
  }
}

async function bootstrapApp() {
  try {
    const status = await fetchAuthStatus();
    authEnabled = Boolean(status.authEnabled);

    if (authEnabled && !status.authenticated) {
      showAuthModal("Enter password to unlock this project.");
      return;
    }

    hideAuthModal();
    await loadDocsTree();
  } catch (error) {
    docList.innerHTML = '<li class="errorText">Failed to initialize</li>';
    docContent.innerHTML =
      '<p class="errorText">Unable to initialize app. Please refresh.</p>';
    console.error("Bootstrap error:", error);
  }
}

mobileMenuButton.addEventListener("click", () => {
  if (document.body.classList.contains("sidebar-open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

sidebarCloseButton.addEventListener("click", closeSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);

fullscreenCloseButton.addEventListener("click", closeFullscreen);
fullscreenModal.addEventListener("click", (event) => {
  if (event.target === fullscreenModal) {
    closeFullscreen();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!authModal.hidden) {
      return;
    }
    if (fullscreenState) {
      closeFullscreen();
      return;
    }
    if (document.body.classList.contains("sidebar-open")) {
      closeSidebar();
    }
  }
});

if (authForm) {
  authForm.addEventListener("submit", handleAuthSubmit);
}

bootstrapApp();
