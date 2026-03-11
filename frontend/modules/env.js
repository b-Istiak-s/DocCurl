const STORAGE_KEYS = {
  env: "doccurl.env",
};

export function normalizeEnvName(name) {
  return String(name || "").trim().replace(/^\$/, "");
}

export function extractPlaceholderNames(text) {
  const names = new Set();
  String(text || "").replace(/\$([A-Za-z_][A-Za-z0-9_]*)\b/g, (matchText, name) => {
    names.add(name);
    return matchText;
  });
  return Array.from(names);
}

export function replacePlaceholders(text, env) {
  return String(text || "").replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)\b/g,
    (match, name) => (Object.hasOwn(env, name) ? env[name] : match),
  );
}

function shouldMaskEnvValue(name) {
  return /token|secret|password|api[_-]?key|bearer|credential|auth|session/i.test(name);
}

function updateEnvValueInputType(nameInput, valueInput) {
  valueInput.type = shouldMaskEnvValue(nameInput.value) ? "password" : "text";
}

export function createEnvManager({ localStorageRef = localStorage, documentRef = document } = {}) {
  let envInputs = [];
  let envToolbarState = { fieldsContainer: null, suggestedNames: [] };

  function loadStoredEnv() {
    const rawValue = localStorageRef.getItem(STORAGE_KEYS.env);
    if (!rawValue) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawValue);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      const normalized = {};
      for (const [name, value] of Object.entries(parsed)) {
        const normalizedName = normalizeEnvName(name);
        if (!normalizedName) {
          continue;
        }
        normalized[normalizedName] = String(value ?? "");
      }

      return normalized;
    } catch {
      return {};
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
    localStorageRef.setItem(STORAGE_KEYS.env, JSON.stringify(values));
  }

  function persistCurrentEnv() {
    persistEnv(getCurrentEnv());
  }

  function createEnvField(name = "", value = "") {
    const row = documentRef.createElement("div");
    row.className = "envFieldRow";

    const nameField = documentRef.createElement("div");
    nameField.className = "envField";

    const nameLabel = documentRef.createElement("label");
    nameLabel.textContent = "Variable";

    const nameInput = documentRef.createElement("input");
    nameInput.type = "text";
    nameInput.className = "envNameInput";
    nameInput.placeholder = "VARIABLE_NAME";
    nameInput.setAttribute("aria-label", "Environment variable name");
    nameInput.value = name;

    nameField.append(nameLabel, nameInput);

    const valueField = documentRef.createElement("div");
    valueField.className = "envField";

    const valueLabel = documentRef.createElement("label");
    valueLabel.textContent = "Value";

    const valueInput = documentRef.createElement("input");
    valueInput.className = "envValueInput";
    valueInput.placeholder = "Environment variable value";
    valueInput.setAttribute("aria-label", "Environment variable value");
    valueInput.value = value;
    updateEnvValueInputType(nameInput, valueInput);

    valueField.append(valueLabel, valueInput);

    const removeButton = documentRef.createElement("button");
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
        createEnvField(name, Object.hasOwn(values, name) ? values[name] : ""),
      );
    });
  }

  function collectPlaceholderNamesFromDocument(container) {
    const names = new Set();
    container.querySelectorAll("pre code.language-curl").forEach((block) => {
      extractPlaceholderNames(block.textContent).forEach((name) => names.add(name));
    });
    return Array.from(names);
  }

  function createEnvToolbar(suggestedNames = [], { onReset } = {}) {
    const envValues = loadStoredEnv();
    const toolbar = documentRef.createElement("div");
    toolbar.className = "docEnvBar";

    const header = documentRef.createElement("div");
    header.className = "envToolbarHeader";

    const title = documentRef.createElement("h3");
    title.className = "envToolbarTitle";
    title.textContent = "Environment Variables";

    const toggleButton = documentRef.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "envToolbarToggle";
    toggleButton.setAttribute("aria-expanded", "false");
    toggleButton.setAttribute("aria-label", "Toggle environment variables");
    toggleButton.textContent = "Show";

    header.append(title, toggleButton);

    const body = documentRef.createElement("div");
    body.className = "envToolbarBody";

    const hint = documentRef.createElement("div");
    hint.className = "envToolbarHint";
    hint.textContent =
      "Add environment variables to replace matching $VARIABLE placeholders before running curl commands.";

    const fieldsContainer = documentRef.createElement("div");
    fieldsContainer.className = "envFieldList";

    const actions = documentRef.createElement("div");
    actions.className = "envActions";

    const addButton = documentRef.createElement("button");
    addButton.id = "doccurl-add-env";
    addButton.className = "secondaryBtn";
    addButton.type = "button";
    addButton.textContent = "Add variable";

    const resetButton = documentRef.createElement("button");
    resetButton.id = "doccurl-reset-all";
    resetButton.className = "resetBtn";
    resetButton.type = "button";
    resetButton.textContent = "Clear all changes";

    actions.append(addButton, resetButton);
    body.append(hint, fieldsContainer, actions);
    toolbar.append(header, body);
    toolbar.classList.add("is-collapsed");

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

    resetButton.addEventListener("click", () => {
      if (typeof onReset === "function") {
        onReset();
      }
    });

    toggleButton.addEventListener("click", () => {
      const isCollapsed = toolbar.classList.toggle("is-collapsed");
      const expanded = !isCollapsed;
      toggleButton.setAttribute("aria-expanded", String(expanded));
      toggleButton.textContent = expanded ? "Hide" : "Show";
    });

    return toolbar;
  }

  return {
    loadStoredEnv,
    getCurrentEnv,
    persistEnv,
    persistCurrentEnv,
    renderEnvFields,
    createEnvToolbar,
    collectPlaceholderNamesFromDocument,
    getSuggestedNames() {
      return envToolbarState.suggestedNames;
    },
  };
}
