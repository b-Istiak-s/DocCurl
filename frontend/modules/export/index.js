import { buildExportCollectionModel } from "./collection-model.js";
import { buildMarkdownExportArchive } from "./markdown/index.js";
import { downloadBinaryFile, downloadJsonFile } from "./download.js";
import { formatInsomniaExport } from "./formatters/insomnia.js";
import { formatOpenApiExport } from "./formatters/openapi.js";
import { formatPostmanExport } from "./formatters/postman.js";

const EXPORT_OPTIONS = [
  { format: "insomnia", label: "Insomnia", kind: "json" },
  { format: "openapi", label: "OpenAPI 3.1", kind: "json" },
  { format: "postman", label: "Postman", kind: "json" },
  { format: "markdown", label: "Markdown", kind: "binary", mimeType: "application/zip" },
];

function formatExportPayload(format, model) {
  if (format === "insomnia") {
    return formatInsomniaExport(model);
  }
  if (format === "openapi") {
    return formatOpenApiExport(model);
  }
  if (format === "postman") {
    return formatPostmanExport(model);
  }
  if (format === "markdown") {
    return buildMarkdownExportArchive(model);
  }
  throw new Error(`Unsupported export format: ${format}`);
}

function createExportFilename(option) {
  if (option.format === "markdown") {
    return "doccurl-export-markdown.zip";
  }
  if (option.format === "openapi") {
    return "doccurl-export-openapi.json";
  }
  return `doccurl-export-${option.format}.json`;
}

export function createCurlExportSystem({
  apiFetch,
  parseJsonSafe,
  withBasePath,
  envManager,
  localStorageRef = globalThis.localStorage,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  downloadJsonImpl = downloadJsonFile,
  downloadBinaryImpl = downloadBinaryFile,
} = {}) {
  const modal = documentRef.createElement("div");
  modal.className = "exportModal";
  modal.hidden = true;

  const card = documentRef.createElement("div");
  card.className = "exportCard";

  const title = documentRef.createElement("h3");
  title.textContent = "Export Curls";

  const hint = documentRef.createElement("p");
  hint.className = "exportHint";
  hint.textContent = "Choose a format to export all docs with your saved curl edits.";

  const actions = documentRef.createElement("div");
  actions.className = "exportOptions";

  const status = documentRef.createElement("p");
  status.className = "exportStatus";

  const closeButton = documentRef.createElement("button");
  closeButton.type = "button";
  closeButton.className = "secondaryBtn exportCloseBtn";
  closeButton.textContent = "Close";

  const optionButtons = EXPORT_OPTIONS.map((option) => {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "secondaryBtn exportOptionBtn";
    button.dataset.format = option.format;
    button.textContent = option.label;
    actions.appendChild(button);
    return button;
  });

  card.append(title, hint, actions, status, closeButton);
  modal.appendChild(card);
  documentRef.body.appendChild(modal);

  async function exportAll(format) {
    status.textContent = "Preparing export...";
    optionButtons.forEach((button) => {
      button.disabled = true;
    });

    try {
      const selectedOption = EXPORT_OPTIONS.find((option) => option.format === format);
      const model = await buildExportCollectionModel({
        apiFetch,
        parseJsonSafe,
        withBasePath,
        localStorageRef,
        env: envManager.getCurrentEnv(),
      });
      const payload = formatExportPayload(format, model);
      if (selectedOption?.kind === "binary") {
        downloadBinaryImpl(createExportFilename(selectedOption), payload, {
          documentRef,
          urlRef: windowRef.URL || URL,
          mimeType: selectedOption.mimeType,
        });
      } else {
        downloadJsonImpl(createExportFilename(selectedOption), payload, {
          documentRef,
          urlRef: windowRef.URL || URL,
        });
      }
      status.textContent = `Exported ${selectedOption?.label || format}.`;
      windowRef.setTimeout(() => {
        closeDialog();
      }, 300);
      return payload;
    } catch (error) {
      status.textContent = `Export failed: ${error.message}`;
      return null;
    } finally {
      optionButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  function openDialog() {
    modal.hidden = false;
    status.textContent = "";
  }

  function closeDialog() {
    modal.hidden = true;
  }

  closeButton.addEventListener("click", closeDialog);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeDialog();
    }
  });

  optionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      exportAll(button.dataset.format);
    });
  });

  return {
    openExportDialog: openDialog,
    closeExportDialog: closeDialog,
    exportAll,
    modal,
  };
}
