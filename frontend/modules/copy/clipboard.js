function quoteShellValue(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

export function serializeEnvForShell(env) {
  return Object.entries(env || {})
    .map(([name, value]) => `export ${name}=${quoteShellValue(value)}`)
    .join("\n");
}

export function buildCopyPayload(command, env) {
  const envBlock = serializeEnvForShell(env);
  const commandBlock = String(command || "");
  return envBlock ? `${envBlock}\n\n${commandBlock}` : commandBlock;
}

export async function copyText(text, { navigatorRef, documentRef } = {}) {
  if (navigatorRef?.clipboard?.writeText) {
    await navigatorRef.clipboard.writeText(text);
    return true;
  }

  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  documentRef.body.appendChild(textarea);

  if (typeof textarea.focus === "function") {
    textarea.focus();
  }
  if (typeof textarea.select === "function") {
    textarea.select();
  }

  try {
    if (!documentRef.execCommand?.("copy")) {
      throw new Error("Copy command was not successful");
    }
  } finally {
    textarea.remove();
  }

  return true;
}

export function createCopyController({
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  let activeTimeoutId = null;

  function setTemporaryButtonLabel(button, label) {
    const nextLabel = String(label || "");
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || "Copy";
    }

    button.textContent = nextLabel;
    if (activeTimeoutId) {
      windowRef.clearTimeout(activeTimeoutId);
    }

    activeTimeoutId = windowRef.setTimeout(() => {
      button.textContent = button.dataset.defaultLabel || "Copy";
      activeTimeoutId = null;
    }, 1500);
  }

  return {
    async copyRequest({ button, command, env }) {
      const payload = buildCopyPayload(command, env);
      try {
        await copyText(payload, { navigatorRef, documentRef });
        setTemporaryButtonLabel(button, "Copied");
        return true;
      } catch {
        setTemporaryButtonLabel(button, "Copy failed");
        return false;
      }
    },
  };
}
