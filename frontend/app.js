const docList = document.getElementById("docList");
const docContent = document.getElementById("docContent");
const mobileMenuButton = document.getElementById("mobileMenuButton");
const sidebarCloseButton = document.getElementById("sidebarCloseButton");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const fullscreenModal = document.getElementById("fullscreenModal");
const fullscreenMount = document.getElementById("fullscreenMount");
const fullscreenCloseButton = document.getElementById("fullscreenCloseButton");

const STORAGE_KEYS = {
  appUrl: "doccurl.app_url",
  token: "doccurl.token",
};

const playgroundStates = new Map();
let playgroundCounter = 0;
let envInputs = { appUrl: null, token: null };
let fullscreenState = null;

function setSidebarOpen(isOpen) {
  document.body.classList.toggle("sidebar-open", isOpen);
}

function closeSidebar() {
  setSidebarOpen(false);
}

function openSidebar() {
  setSidebarOpen(true);
}

function loadStoredEnv() {
  return {
    appUrl: localStorage.getItem(STORAGE_KEYS.appUrl) || "",
    token: localStorage.getItem(STORAGE_KEYS.token) || "",
  };
}

function getCurrentEnv() {
  if (envInputs.appUrl && envInputs.token) {
    return {
      appUrl: envInputs.appUrl.value.trim(),
      token: envInputs.token.value.trim(),
    };
  }
  return loadStoredEnv();
}

function persistEnv(values) {
  localStorage.setItem(STORAGE_KEYS.appUrl, values.appUrl);
  localStorage.setItem(STORAGE_KEYS.token, values.token);
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
  let nextText = text;
  if (env.appUrl) {
    nextText = nextText.replace(/\$APP_URL\b/g, env.appUrl);
  }
  if (env.token) {
    nextText = nextText.replace(/\$TOKEN\b/g, env.token);
  }
  return nextText;
}

function detectMissingEnv(command, env) {
  const missing = [];
  if (/\$APP_URL\b/.test(command) && !env.appUrl) {
    missing.push("APP_URL");
  }
  if (/\$TOKEN\b/.test(command) && !env.token) {
    missing.push("TOKEN");
  }
  return missing;
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
  // Preserve final line height when textarea ends with newline.
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
    const response = await fetch("/api/run-curl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const data = await response.json();

    if (response.ok && data.success) {
      renderResponseOutput(outputElement, data.output);
      return;
    }

    const errorText = data.error || data.details || "Request failed";
    renderResponseOutput(outputElement, `Error: ${errorText}`, true);
  } catch (error) {
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

function createEnvToolbar() {
  const envValues = loadStoredEnv();
  const toolbar = document.createElement("div");
  toolbar.className = "docEnvBar";
  toolbar.innerHTML = `
    <div class="envField">
      <label for="doccurl-app-url">APP_URL</label>
      <input id="doccurl-app-url" type="text" placeholder="https://api.example.com" />
    </div>
    <div class="envField">
      <label for="doccurl-token">TOKEN</label>
      <input id="doccurl-token" type="password" placeholder="Paste bearer token" />
    </div>
    <div class="envActions">
      <button id="doccurl-reset-all" class="resetBtn" type="button">Clear all changes</button>
    </div>
  `;

  envInputs = {
    appUrl: toolbar.querySelector("#doccurl-app-url"),
    token: toolbar.querySelector("#doccurl-token"),
  };

  envInputs.appUrl.value = envValues.appUrl;
  envInputs.token.value = envValues.token;

  const onInput = () => {
    persistEnv(getCurrentEnv());
  };

  envInputs.appUrl.addEventListener("input", onInput);
  envInputs.token.addEventListener("input", onInput);

  const resetButton = toolbar.querySelector("#doccurl-reset-all");
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
    const missing = detectMissingEnv(visibleCommand, env);
    if (missing.length > 0) {
      showOutputMessage(
        outputElement,
        `Error: Missing required value(s): ${missing.join(", ")}`,
        true,
      );
      return;
    }

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

function setActiveDocButton(filename) {
  for (const button of docList.querySelectorAll(".docListButton")) {
    button.classList.toggle("active", button.dataset.filename === filename);
  }
}

async function loadDoc(filename) {
  if (fullscreenState) {
    closeFullscreen();
  }

  setActiveDocButton(filename);
  docContent.innerHTML = '<div class="loading">Loading document...</div>';

  try {
    const response = await fetch(`/api/docs/${filename}`);
    const data = await response.json();

    if (!response.ok) {
      docContent.innerHTML = `<p class="errorText">Error: ${data.error}</p>`;
      return;
    }

    docContent.innerHTML = data.html;
    docContent.prepend(createEnvToolbar());
    initializeCurlPlaygrounds();

    if (window.matchMedia("(max-width: 960px)").matches) {
      closeSidebar();
    }
  } catch (error) {
    docContent.innerHTML =
      '<p class="errorText">Error loading document. Please try again.</p>';
    console.error("Error loading document:", error);
  }
}

async function loadDocsList() {
  try {
    const response = await fetch("/api/docs");
    const files = await response.json();

    docList.innerHTML = "";
    files.forEach((file) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docListButton";
      button.dataset.filename = file;
      button.textContent = file.replace(".md", "");
      button.addEventListener("click", () => {
        loadDoc(file);
      });
      item.appendChild(button);
      docList.appendChild(item);
    });

    if (files.length > 0) {
      loadDoc(files[0]);
    } else {
      docContent.innerHTML = '<p class="errorText">No markdown docs found.</p>';
    }
  } catch (error) {
    docList.innerHTML = '<li class="errorText">Error loading docs list</li>';
    console.error("Error loading docs:", error);
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
    if (fullscreenState) {
      closeFullscreen();
      return;
    }
    if (document.body.classList.contains("sidebar-open")) {
      closeSidebar();
    }
  }
});

loadDocsList();
