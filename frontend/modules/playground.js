import { replacePlaceholders } from "./env.js";

const STORAGE_KEYS = {
  curlEdits: "doccurl.curlEdits.v1",
};
const RESERVED_STORAGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const UPLOAD_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
};

function hashString(value) {
  let hash = 2166136261;
  const input = String(value || "");

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function normalizeStoredCurlEdits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.create(null);
  }

  const normalized = Object.create(null);

  for (const [docPath, entries] of Object.entries(value)) {
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      continue;
    }

    const docKey = String(docPath);
    if (!docKey || RESERVED_STORAGE_KEYS.has(docKey)) {
      continue;
    }

    const normalizedEntries = Object.create(null);
    for (const [blockId, command] of Object.entries(entries)) {
      const entryKey = String(blockId);
      if (
        !entryKey ||
        RESERVED_STORAGE_KEYS.has(entryKey) ||
        typeof command !== "string"
      ) {
        continue;
      }
      normalizedEntries[entryKey] = command;
    }

    if (Object.keys(normalizedEntries).length > 0) {
      normalized[docKey] = normalizedEntries;
    }
  }

  return normalized;
}

export function loadStoredCurlEdits(localStorageRef = globalThis.localStorage) {
  if (!localStorageRef?.getItem) {
    return Object.create(null);
  }

  const rawValue = localStorageRef.getItem(STORAGE_KEYS.curlEdits);
  if (!rawValue) {
    return Object.create(null);
  }

  try {
    return normalizeStoredCurlEdits(JSON.parse(rawValue));
  } catch {
    return Object.create(null);
  }
}

function persistStoredCurlEdits(edits, localStorageRef = globalThis.localStorage) {
  if (!localStorageRef?.setItem) {
    return;
  }

  localStorageRef.setItem(
    STORAGE_KEYS.curlEdits,
    JSON.stringify(normalizeStoredCurlEdits(edits)),
  );
}

export function createStableCurlBlockId(docPath, blockIndex, originalCommand) {
  const normalizedCommand = formatCurlCommand(originalCommand) || String(originalCommand || "").trim();
  return `curl-${blockIndex}-${hashString(`${docPath}\n${normalizedCommand}`)}`;
}

export function getStoredCurlEdit(docPath, blockId, localStorageRef = globalThis.localStorage) {
  const edits = loadStoredCurlEdits(localStorageRef);
  return edits[docPath]?.[blockId] || "";
}

export function saveStoredCurlEdit(
  docPath,
  blockId,
  command,
  originalCommand,
  localStorageRef = globalThis.localStorage,
) {
  const edits = loadStoredCurlEdits(localStorageRef);
  const normalizedCommand = String(command || "");
  const normalizedOriginal = String(originalCommand || "");

  if (!docPath || !blockId) {
    return edits;
  }

  if (!normalizedCommand || normalizedCommand === normalizedOriginal) {
    if (edits[docPath]) {
      delete edits[docPath][blockId];
      if (Object.keys(edits[docPath]).length === 0) {
        delete edits[docPath];
      }
      persistStoredCurlEdits(edits, localStorageRef);
    }
    return edits;
  }

  edits[docPath] = edits[docPath] || Object.create(null);
  edits[docPath][blockId] = normalizedCommand;
  persistStoredCurlEdits(edits, localStorageRef);
  return edits;
}

export function clearStoredCurlEditsForDocument(
  docPath,
  localStorageRef = globalThis.localStorage,
) {
  const edits = loadStoredCurlEdits(localStorageRef);

  if (!docPath || !edits[docPath]) {
    return edits;
  }

  delete edits[docPath];
  persistStoredCurlEdits(edits, localStorageRef);
  return edits;
}

export function clearAllStoredCurlEdits(localStorageRef = globalThis.localStorage) {
  const emptyEdits = Object.create(null);
  persistStoredCurlEdits(emptyEdits, localStorageRef);
  return emptyEdits;
}

export function tokenizeShell(input) {
  const normalizedInput = String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (let i = 0; i < normalizedInput.length; i += 1) {
    const ch = normalizedInput[i];

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
        const next = normalizedInput[i + 1];
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

function parseMultipartFieldDefinition(rawValue) {
  const value = String(rawValue || "").trim();
  const separatorIndex = value.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const name = value.slice(0, separatorIndex).trim();
  const fieldValue = value.slice(separatorIndex + 1).trim();
  if (!name) {
    return null;
  }

  if (/^@R&\{[^{}]+\}$/.test(fieldValue)) {
    return {
      name,
      rawValue: value,
      source: "generated",
    };
  }

  if (fieldValue.startsWith("@")) {
    const uploadReference = fieldValue.slice(1).trim();
    if (!uploadReference || uploadReference.includes(";")) {
      return {
        name,
        rawValue: value,
        source: "unsupported",
      };
    }

    return {
      name,
      rawValue: value,
      source: "upload",
    };
  }

  return {
    name,
    rawValue: value,
    source: "text",
  };
}

function parseCurlMultipartMetadata(command) {
  let tokens = [];

  try {
    tokens = tokenizeShell(String(command || ""));
  } catch {
    return {
      hasMultipart: false,
      uploadParts: [],
    };
  }

  if (!tokens.length || tokens[0] !== "curl") {
    return {
      hasMultipart: false,
      uploadParts: [],
    };
  }

  const uploadParts = [];
  let hasMultipart = false;

  function addMultipartToken(rawValue) {
    hasMultipart = true;
    const parsedPart = parseMultipartFieldDefinition(rawValue);
    if (!parsedPart || parsedPart.source !== "upload") {
      return;
    }

    uploadParts.push({
      ...parsedPart,
      uploadIndex: uploadParts.length,
      signature: `${parsedPart.name}\n${parsedPart.rawValue}`,
    });
  }

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === "-F" || token === "--form") {
      addMultipartToken(tokens[i + 1] || "");
      i += 1;
      continue;
    }

    if (token.startsWith("--form=")) {
      addMultipartToken(token.slice("--form=".length));
      continue;
    }

    if (token.startsWith("-F") && token.length > 2) {
      addMultipartToken(token.slice(2));
    }
  }

  return {
    hasMultipart,
    uploadParts,
  };
}

function formatUploadSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1).replace(/\.0$/, "")} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function createUploadFieldName(uploadIndex) {
  return `upload_${uploadIndex}`;
}

function createUploadInputId(blockId, uploadIndex) {
  return `${blockId}-upload-${uploadIndex}`;
}

function createUploadLabelText(parts, part) {
  const matchingParts = parts.filter((candidate) => candidate.name === part.name);
  if (matchingParts.length <= 1) {
    return part.name;
  }

  const position = matchingParts.findIndex(
    (candidate) => candidate.uploadIndex === part.uploadIndex && candidate.signature === part.signature,
  );

  return `${part.name} (${position + 1})`;
}

function mapSelectedUploadsToParts(previousParts, selectedUploadFiles, nextParts) {
  const nextSelectedFiles = new Map();
  const usedPreviousIndices = new Set();

  const assignFile = (nextPart, previousPart) => {
    const selectedFile = selectedUploadFiles.get(previousPart.uploadIndex);
    if (!selectedFile || usedPreviousIndices.has(previousPart.uploadIndex)) {
      return false;
    }

    usedPreviousIndices.add(previousPart.uploadIndex);
    nextSelectedFiles.set(nextPart.uploadIndex, selectedFile);
    return true;
  };

  for (const nextPart of nextParts) {
    const matchingPart = previousParts.find(
      (candidate) =>
        candidate.signature === nextPart.signature &&
        !usedPreviousIndices.has(candidate.uploadIndex),
    );

    if (matchingPart && assignFile(nextPart, matchingPart)) {
      continue;
    }

    const nextPartPosition = nextParts
      .slice(0, nextParts.indexOf(nextPart) + 1)
      .filter((candidate) => candidate.name === nextPart.name).length;
    const matchingNamePart = previousParts
      .filter((candidate) => candidate.name === nextPart.name)
      [nextPartPosition - 1];

    if (matchingNamePart && assignFile(nextPart, matchingNamePart)) {
      continue;
    }

    const matchingIndexPart = previousParts.find(
      (candidate) =>
        candidate.uploadIndex === nextPart.uploadIndex &&
        !usedPreviousIndices.has(candidate.uploadIndex),
    );

    if (matchingIndexPart) {
      assignFile(nextPart, matchingIndexPart);
    }
  }

  return nextSelectedFiles;
}

function sumUploadSizes(files) {
  let total = 0;
  for (const file of files.values()) {
    total += Number(file?.size) || 0;
  }
  return total;
}

function describeSelectedUpload(file) {
  if (!file) {
    return "No file selected";
  }
  return `${file.name} (${formatUploadSize(file.size)})`;
}

export function formatCurlCommand(command) {
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
  const formEntries = [];
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

    if (token === "-F" || token === "--form") {
      formEntries.push(tokens[i + 1] || "");
      i += 1;
      continue;
    }

    if (token.startsWith("--form=")) {
      formEntries.push(token.slice("--form=".length));
      continue;
    }

    if (token.startsWith("-F") && token.length > 2) {
      formEntries.push(token.slice(2));
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
    method = dataEntries.length > 0 || formEntries.length > 0 ? "POST" : "GET";
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

  for (const formEntry of formEntries) {
    lines.push(`  -F ${quoteDouble(formEntry)} \\`);
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
  outputElement.innerHTML = '<div class="outputEmpty">Run a command to see the response</div>';
}

function normalizeResponseMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const statusCode = Number.isFinite(metadata.statusCode) ? metadata.statusCode : null;
  const contentType =
    typeof metadata.contentType === "string" && metadata.contentType.trim()
      ? metadata.contentType.trim()
      : null;
  const durationMs = Number.isFinite(metadata.durationMs) ? metadata.durationMs : null;

  if (statusCode == null && contentType == null && durationMs == null) {
    return null;
  }

  return {
    statusCode,
    contentType,
    durationMs,
  };
}

function formatResponseDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "Unavailable";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0$/, "$1")} s`;
}

function hideResponseMetaToast(state) {
  if (state.responseMetaTimeoutId) {
    state.windowRef.clearTimeout(state.responseMetaTimeoutId);
    state.responseMetaTimeoutId = null;
  }
  state.responseMetaToast.classList.remove("is-visible");
}

function renderResponseMetaToast(state) {
  const metadata = state.responseMetadata;
  if (!metadata) {
    state.responseMetaToast.replaceChildren();
    return;
  }

  const items = [
    ["Status", metadata.statusCode == null ? "Unavailable" : String(metadata.statusCode)],
    ["Content-Type", metadata.contentType || "Unavailable"],
    ["Time", formatResponseDuration(metadata.durationMs)],
  ];

  const titleElement = state.documentRef.createElement("div");
  titleElement.className = "responseMetaToastTitle";
  titleElement.textContent = "Response Details";

  const listElement = state.documentRef.createElement("dl");
  listElement.className = "responseMetaToastList";

  items.forEach(([label, value]) => {
    const term = state.documentRef.createElement("dt");
    term.textContent = label;

    const description = state.documentRef.createElement("dd");
    description.textContent = value;

    listElement.append(term, description);
  });

  state.responseMetaToast.replaceChildren(titleElement, listElement);
}

function showResponseMetaToast(state) {
  if (!state.responseMetadata) {
    return;
  }

  renderResponseMetaToast(state);
  state.responseMetaToast.classList.add("is-visible");

  if (state.responseMetaTimeoutId) {
    state.windowRef.clearTimeout(state.responseMetaTimeoutId);
  }

  state.responseMetaTimeoutId = state.windowRef.setTimeout(() => {
    state.responseMetaToast.classList.remove("is-visible");
    state.responseMetaTimeoutId = null;
  }, 5000);
}

function setResponseMetadata(state, metadata) {
  state.responseMetadata = normalizeResponseMetadata(metadata);
  state.responseMetaButton.disabled = !state.responseMetadata;
  hideResponseMetaToast(state);
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
    } catch {
      // ignore line number rendering issues
    }
  }
}

export function createPlaygroundSystem({
  docContent,
  fullscreenModal,
  fullscreenMount,
  apiFetch,
  parseJsonSafe,
  withBasePath,
  envManager,
  copyController = {
    async copyRequest() {
      return false;
    },
  },
  FormDataRef = globalThis.FormData,
  localStorageRef = globalThis.localStorage,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
}) {
  const playgroundStates = new Map();
  let playgroundCounter = 0;
  let fullscreenState = null;
  let currentDocPath = "";
  const bodyElement = documentRef?.body || globalThis.document?.body || null;

  function persistEditorValue(state) {
    saveStoredCurlEdit(
      state.docPath,
      state.blockId,
      state.editorElement.value,
      state.originalTemplate,
      localStorageRef,
    );
  }

  function resetVisiblePlaygroundState(state) {
    state.editorElement.value = state.originalTemplate;
    state.selectedUploadFiles.clear();
    state.uploadValidationMessage = "";
    state.isUploadPanelOpen = false;
    state.multipartMetadata = parseCurlMultipartMetadata(state.originalTemplate);
    syncCurlOverlay(state, { highlight: true });
    syncCurlOverlayScroll(state);
    syncUploadUI(state);
    setResponseMetadata(state, null);
    renderEmpty(state.outputElement);
  }

  function openFullscreen(playgroundElement) {
    if (fullscreenState) {
      closeFullscreen();
    }

    const placeholder = documentRef.createElement("div");
    placeholder.className = "fullscreenPlaceholder";
    playgroundElement.after(placeholder);
    fullscreenMount.appendChild(playgroundElement);

    fullscreenState = { playgroundElement, placeholder };
    fullscreenModal.hidden = false;
    bodyElement.classList.add("fullscreen-open");
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
    bodyElement.classList.remove("fullscreen-open");
  }

  function setUploadValidationMessage(state, message = "") {
    state.uploadValidationMessage = String(message || "");
    if (state.uploadErrorElement) {
      state.uploadErrorElement.textContent = state.uploadValidationMessage;
      state.uploadErrorElement.hidden = !state.uploadValidationMessage;
    }
  }

  function setUploadPanelOpen(state, isOpen, { clearValidation = false } = {}) {
    state.isUploadPanelOpen = Boolean(isOpen);
    if (clearValidation) {
      setUploadValidationMessage(state, "");
    }
  }

  function syncSelectedUploads(state, multipartMetadata) {
    state.selectedUploadFiles = mapSelectedUploadsToParts(
      state.multipartMetadata?.uploadParts || [],
      state.selectedUploadFiles,
      multipartMetadata.uploadParts,
    );
  }

  function renderUploadRows(state) {
    state.uploadListElement.replaceChildren();

    state.multipartMetadata.uploadParts.forEach((part) => {
      const row = state.documentRef.createElement("div");
      row.className = "curlUploadRow";

      const nameCell = state.documentRef.createElement("div");
      nameCell.className = "curlUploadNameCell";
      const nameText = state.documentRef.createElement("label");
      nameText.className = "curlUploadFieldName";
      nameText.textContent = createUploadLabelText(state.multipartMetadata.uploadParts, part);

      const fileCell = state.documentRef.createElement("div");
      fileCell.className = "curlUploadFileCell";
      const fileInput = state.documentRef.createElement("input");
      fileInput.className = "curlUploadInput";
      fileInput.type = "file";
      fileInput.id = createUploadInputId(state.blockId, part.uploadIndex);
      nameText.setAttribute("for", fileInput.id);

      const fileMeta = state.documentRef.createElement("div");
      fileMeta.className = "curlUploadMeta";
      fileMeta.textContent = describeSelectedUpload(
        state.selectedUploadFiles.get(part.uploadIndex),
      );

      fileInput.addEventListener("change", (event) => {
        const selectedFile = event.target?.files?.[0] || null;
        if (!selectedFile) {
          state.selectedUploadFiles.delete(part.uploadIndex);
          setUploadValidationMessage(state, "");
          syncUploadUI(state);
          return;
        }

        if (selectedFile.size > UPLOAD_LIMITS.maxFileBytes) {
          setUploadValidationMessage(
            state,
            `Each file must be ${formatUploadSize(UPLOAD_LIMITS.maxFileBytes)} or smaller.`,
          );
          syncUploadUI(state);
          return;
        }

        const nextFiles = new Map(state.selectedUploadFiles);
        nextFiles.set(part.uploadIndex, selectedFile);
        if (sumUploadSizes(nextFiles) > UPLOAD_LIMITS.maxTotalBytes) {
          setUploadValidationMessage(
            state,
            `Selected files must total ${formatUploadSize(UPLOAD_LIMITS.maxTotalBytes)} or less.`,
          );
          syncUploadUI(state);
          return;
        }

        state.selectedUploadFiles = nextFiles;
        setUploadValidationMessage(state, "");
        syncUploadUI(state);
      });

      nameCell.appendChild(nameText);
      fileCell.append(fileInput, fileMeta);
      row.append(nameCell, fileCell);
      state.uploadListElement.appendChild(row);
    });
  }

  function syncUploadUI(state) {
    const hasUploadParts = state.multipartMetadata.uploadParts.length > 0;
    state.uploadToggleButton.hidden = !hasUploadParts;

    if (!hasUploadParts) {
      state.selectedUploadFiles.clear();
      state.isUploadPanelOpen = false;
      state.requestEditorView.hidden = false;
      state.editorElement.disabled = false;
      state.uploadPanel.hidden = true;
      state.uploadListElement.replaceChildren();
      setUploadValidationMessage(state, "");
      return;
    }

    state.requestEditorView.hidden = state.isUploadPanelOpen;
    state.editorElement.disabled = state.isUploadPanelOpen;
    state.uploadPanel.hidden = !state.isUploadPanelOpen;

    if (!state.isUploadPanelOpen) {
      return;
    }

    state.editorElement.blur?.();
    renderUploadRows(state);
    setUploadValidationMessage(state, state.uploadValidationMessage);
  }

  function syncMultipartState(state) {
    const multipartMetadata = parseCurlMultipartMetadata(state.editorElement.value || "");
    syncSelectedUploads(state, multipartMetadata);
    state.multipartMetadata = multipartMetadata;
    if (multipartMetadata.uploadParts.length === 0) {
      state.selectedUploadFiles.clear();
      setUploadPanelOpen(state, false, { clearValidation: true });
    }
    syncUploadUI(state);
  }

  function isSoccliState(state) {
    return state.commandKind === "soccli";
  }

  function buildRunRequest(command, state) {
    if (isSoccliState(state)) {
      return {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      };
    }

    const resolvedMultipartMetadata = parseCurlMultipartMetadata(command);
    const resolvedSelectedFiles = mapSelectedUploadsToParts(
      state.multipartMetadata.uploadParts,
      state.selectedUploadFiles,
      resolvedMultipartMetadata.uploadParts,
    );
    const relevantFiles = new Map();

    for (const part of resolvedMultipartMetadata.uploadParts) {
      const selectedFile = resolvedSelectedFiles.get(part.uploadIndex);
      if (!selectedFile) {
        state.multipartMetadata = resolvedMultipartMetadata;
        state.selectedUploadFiles = resolvedSelectedFiles;
        setUploadPanelOpen(state, true);
        setUploadValidationMessage(
          state,
          `Select a file for multipart field "${part.name}" before running this curl.`,
        );
        syncUploadUI(state);
        return null;
      }
      if (selectedFile.size > UPLOAD_LIMITS.maxFileBytes) {
        state.multipartMetadata = resolvedMultipartMetadata;
        state.selectedUploadFiles = resolvedSelectedFiles;
        setUploadPanelOpen(state, true);
        setUploadValidationMessage(
          state,
          `Each file must be ${formatUploadSize(UPLOAD_LIMITS.maxFileBytes)} or smaller.`,
        );
        syncUploadUI(state);
        return null;
      }
      relevantFiles.set(part.uploadIndex, selectedFile);
    }

    if (sumUploadSizes(relevantFiles) > UPLOAD_LIMITS.maxTotalBytes) {
      state.multipartMetadata = resolvedMultipartMetadata;
      state.selectedUploadFiles = resolvedSelectedFiles;
      setUploadPanelOpen(state, true);
      setUploadValidationMessage(
        state,
        `Selected files must total ${formatUploadSize(UPLOAD_LIMITS.maxTotalBytes)} or less.`,
      );
      syncUploadUI(state);
      return null;
    }

    setUploadValidationMessage(state, "");

    if (relevantFiles.size === 0) {
      return {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      };
    }

    const formData = new FormDataRef();
    formData.append("command", command);
    for (const part of resolvedMultipartMetadata.uploadParts) {
      const file = relevantFiles.get(part.uploadIndex);
      formData.append(createUploadFieldName(part.uploadIndex), file, file.name);
    }

    return {
      body: formData,
    };
  }

  async function runCurlCommand(requestOptions, state) {
    renderLoading(state.outputElement);
    setResponseMetadata(state, null);
    const { urlOverride, ...fetchOptions } = requestOptions;
    try {
      const response = await apiFetch(withBasePath(urlOverride || "/api/run-curl"), {
        method: "POST",
        signal: state.activeRunController?.signal,
        ...fetchOptions,
      });

      const data = await parseJsonSafe(response);

      if (response.ok && data.success) {
        renderResponseOutput(state.outputElement, data.output);
        setResponseMetadata(state, data.metadata);
        return;
      }

      const errorText = data.error || "Request failed";
      renderResponseOutput(state.outputElement, `Error: ${errorText}`, true);
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      if (error.code === "UNAUTHORIZED") {
        showOutputMessage(
          state.outputElement,
          "Error: Unauthorized. Enter password to continue.",
          true,
        );
        return;
      }
      showOutputMessage(state.outputElement, `Error: ${error.message}`, true);
    } finally {
      if (!state.activeRunController?.signal?.aborted) {
        state.activeRunController = null;
      }
    }
  }

  function renderStreamingStart(outputElement) {
    outputElement.innerHTML = "";
    const preElement = documentRef.createElement("pre");
    const codeElement = documentRef.createElement("code");
    codeElement.className = "language-plaintext";
    preElement.appendChild(codeElement);
    outputElement.appendChild(preElement);
    return codeElement;
  }

  async function runSoccliCommand(requestOptions, state) {
    renderLoading(state.outputElement);
    setResponseMetadata(state, null);
    const { urlOverride, ...fetchOptions } = requestOptions;
    try {
      const response = await apiFetch(withBasePath(urlOverride || "/api/run-soccli"), {
        method: "POST",
        signal: state.activeRunController?.signal,
        ...fetchOptions,
      });

      if (!response.ok) {
        const data = await parseJsonSafe(response);
        const errorText = data.error || "Request failed";
        renderResponseOutput(state.outputElement, `Error: ${errorText}`, true);
        return;
      }

      const outputCode = renderStreamingStart(state.outputElement);
      const responseBody = response.body;

      if (!responseBody?.getReader) {
        const data = await parseJsonSafe(response);
        renderResponseOutput(state.outputElement, data.output || "", false);
        return;
      }

      const reader = responseBody.getReader();
      const decoder = new TextDecoder();
      let received = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        received += decoder.decode(value, { stream: true });
        outputCode.textContent = received;
      }

      received += decoder.decode();
      outputCode.textContent = received;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      if (error.code === "UNAUTHORIZED") {
        showOutputMessage(
          state.outputElement,
          "Error: Unauthorized. Enter password to continue.",
          true,
        );
        return;
      }
      showOutputMessage(state.outputElement, `Error: ${error.message}`, true);
    } finally {
      if (!state.activeRunController?.signal?.aborted) {
        state.activeRunController = null;
      }
    }
  }

  async function handleRunRequest(state) {
    const env = envManager.getCurrentEnv();
    const visibleCommand = state.editorElement.value || "";
    const resolvedCommand = replacePlaceholders(visibleCommand, env);
    const requestOptions = buildRunRequest(resolvedCommand, state);
    if (!requestOptions) {
      return;
    }
    if (state.activeRunController) {
      state.activeRunController.abort();
    }
    state.activeRunController = new AbortController();
    const runPath = state.commandKind === "soccli" ? "/api/run-soccli" : "/api/run-curl";
    const runRequest = isSoccliState(state) ? runSoccliCommand : runCurlCommand;
    await runRequest(
      {
        ...requestOptions,
        urlOverride: runPath,
      },
      state,
    );
  }

  function createPlayground(commandText, { docPath, blockIndex, commandKind = "curl" }) {
    const playgroundId = `playground-${playgroundCounter}`;
    playgroundCounter += 1;
    const originalTemplate = formatCurlCommand(commandText);
    const blockDocPath = commandKind === "curl" ? docPath : `${docPath}:soccli`;
    const blockId = createStableCurlBlockId(blockDocPath, blockIndex, originalTemplate);
    const isSoccli = commandKind === "soccli";

    const playground = documentRef.createElement("div");
    playground.className = isSoccli ? "soccliPlaygroundInline" : "curlPlaygroundInline";
    playground.dataset.playgroundId = playgroundId;
    playground.dataset.curlBlockId = blockId;
    playground.dataset.playgroundKind = commandKind;
    playground.innerHTML = `
      <section class="playgroundPane">
        <div class="panelHeader">${isSoccli ? "Soccli Command" : "Request"}</div>
        <div class="requestPaneBody">
          <div class="requestEditorView">
            <div class="curlScriptWrapper">
              <div class="curlEditorShell">
                <pre class="curlOverlay"><code class="language-bash"></code></pre>
                <textarea class="curlEditor" spellcheck="false" aria-label="Command editor"></textarea>
              </div>
            </div>
            <div class="panelActions">
              <button type="button" class="copyBtn">Copy</button>
              <button type="button" class="uploadToggleBtn" hidden>Upload Files</button>
              <button type="button" class="runBtn">Run</button>
            </div>
          </div>
          <div class="curlUploadPanel" hidden>
            <div class="curlUploadError" hidden></div>
            <div class="curlUploadList"></div>
            <div class="curlUploadActions">
              <button type="button" class="hideUploadsBtn">Hide Uploads</button>
              <button type="button" class="uploadRunBtn">Run</button>
            </div>
          </div>
        </div>
      </section>
      <section class="playgroundPane responsePane">
        <div class="panelHeader responseHeader">
          <span>Response</span>
          <button type="button" class="responseMetaBtn" disabled>Details</button>
        </div>
        <div class="responseMetaToast" role="status" aria-live="polite"></div>
        <div class="curlOutput">
          <div class="outputEmpty">Run a command to see the response</div>
        </div>
        <div class="panelActions">
          <button type="button" class="fullscreenBtn">Fullscreen</button>
        </div>
      </section>
    `;

    const editorElement = playground.querySelector(".curlEditor");
    const requestEditorView = playground.querySelector(".requestEditorView");
    const editorShell = playground.querySelector(".curlEditorShell");
    const overlayElement = playground.querySelector(".curlOverlay");
    const overlayCode = overlayElement.querySelector("code");
    const outputElement = playground.querySelector(".curlOutput");
    const responseMetaButton = playground.querySelector(".responseMetaBtn");
    const responseMetaToast = playground.querySelector(".responseMetaToast");
    const copyButton = playground.querySelector(".copyBtn");
    const uploadToggleButton = playground.querySelector(".uploadToggleBtn");
    const uploadPanel = playground.querySelector(".curlUploadPanel");
    const uploadListElement = playground.querySelector(".curlUploadList");
    const uploadErrorElement = playground.querySelector(".curlUploadError");
    const uploadHideButton = playground.querySelector(".hideUploadsBtn");
    const uploadRunButton = playground.querySelector(".uploadRunBtn");
    const runButton = playground.querySelector(".runBtn");
    const fullscreenButton = playground.querySelector(".fullscreenBtn");
    const storedValue = getStoredCurlEdit(docPath, blockId, localStorageRef);
    editorElement.value = storedValue || originalTemplate;

    const state = {
      playgroundElement: playground,
      docPath,
      blockId,
      editorElement,
      requestEditorView,
      editorShell,
      overlayElement,
      overlayCode,
      outputElement,
      responseMetaButton,
      responseMetaToast,
      copyButton,
      uploadToggleButton,
      uploadPanel,
      uploadListElement,
      uploadErrorElement,
      uploadHideButton,
      uploadRunButton,
      runButton,
      fullscreenButton,
      originalTemplate,
      commandKind,
      multipartMetadata: parseCurlMultipartMetadata(editorElement.value || ""),
      selectedUploadFiles: new Map(),
      isUploadPanelOpen: false,
      uploadValidationMessage: "",
      responseMetadata: null,
      responseMetaTimeoutId: null,
      activeRunController: null,
      documentRef,
      windowRef,
    };
    playgroundStates.set(playgroundId, state);

    if (isSoccli) {
      uploadToggleButton.hidden = true;
      uploadPanel.hidden = true;
      uploadRunButton.hidden = true;
      uploadHideButton.hidden = true;
      responseMetaButton.hidden = true;
      responseMetaToast.hidden = true;
    }

    syncCurlOverlay(state, { highlight: true });
    syncCurlOverlayScroll(state);
    syncUploadUI(state);
    setResponseMetadata(state, null);

    editorElement.addEventListener("input", () => {
      syncCurlOverlay(state, { highlight: true });
      syncCurlOverlayScroll(state);
      if (!isSoccliState(state)) {
        syncMultipartState(state);
      }
      persistEditorValue(state);
    });

    editorElement.addEventListener("scroll", () => {
      syncCurlOverlayScroll(state);
    });

    editorElement.addEventListener("blur", () => {
      prettifyTextareaCommand(state);
      syncCurlOverlay(state, { highlight: true });
      syncCurlOverlayScroll(state);
      if (!isSoccliState(state)) {
        syncMultipartState(state);
      }
      persistEditorValue(state);
    });

    uploadToggleButton.addEventListener("click", () => {
      setUploadPanelOpen(state, true);
      syncUploadUI(state);
    });

    uploadHideButton.addEventListener("click", () => {
      setUploadPanelOpen(state, false, { clearValidation: true });
      syncUploadUI(state);
    });

    runButton.addEventListener("click", async () => {
      await handleRunRequest(state);
    });

    uploadRunButton.addEventListener("click", async () => {
      await handleRunRequest(state);
    });

    copyButton.addEventListener("click", async () => {
      await copyController.copyRequest({
        button: copyButton,
        command: editorElement.value || "",
        env: envManager.getCurrentEnv(),
      });
    });

    fullscreenButton.addEventListener("click", () => {
      openFullscreen(playground);
    });

    responseMetaButton.addEventListener("click", () => {
      showResponseMetaToast(state);
    });

    return playground;
  }

  function resetCurrentDocument() {
    if (fullscreenState) {
      closeFullscreen();
    }

    clearStoredCurlEditsForDocument(currentDocPath, localStorageRef);

    for (const state of playgroundStates.values()) {
      if (state.docPath === currentDocPath) {
        resetVisiblePlaygroundState(state);
      }
    }
  }

  function resetAllDocuments() {
    if (fullscreenState) {
      closeFullscreen();
    }

    clearAllStoredCurlEdits(localStorageRef);

    for (const state of playgroundStates.values()) {
      resetVisiblePlaygroundState(state);
    }
  }

  function initializeCurlPlaygrounds(docPath) {
    for (const state of playgroundStates.values()) {
      hideResponseMetaToast(state);
    }
    playgroundStates.clear();
    currentDocPath = docPath;
    const codeBlocks = [...docContent.querySelectorAll("pre code.language-curl")];

    codeBlocks.forEach((block, blockIndex) => {
      const curlCommand = block.textContent.trim();
      const preElement = block.parentElement;
      const playground = createPlayground(curlCommand, {
        docPath,
        blockIndex,
        commandKind: "curl",
      });
      preElement.replaceWith(playground);
    });
  }

  function initializeSoccliPlaygrounds(docPath) {
    const codeBlocks = [...docContent.querySelectorAll("pre code.language-soccli")];

    codeBlocks.forEach((block, blockIndex) => {
      const command = block.textContent.trim();
      const preElement = block.parentElement;
      const playground = createPlayground(command, {
        docPath,
        blockIndex,
        commandKind: "soccli",
      });
      preElement.replaceWith(playground);
    });
  }

  function initializeCommandPlaygrounds(docPath) {
    initializeCurlPlaygrounds(docPath);
    initializeSoccliPlaygrounds(docPath);
  }

  return {
    closeFullscreen,
    openFullscreen,
    resetCurrentDocument,
    resetAllDocuments,
    initializeCurlPlaygrounds: initializeCommandPlaygrounds,
    initializeSoccliPlaygrounds,
    hasFullscreenOpen() {
      return Boolean(fullscreenState);
    },
    getCurrentDocPath() {
      return currentDocPath;
    },
  };
}
