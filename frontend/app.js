const docList = document.getElementById("docList");
const docContent = document.getElementById("docContent");

// Fetch and display list of markdown files
async function loadDocsList() {
  try {
    const response = await fetch("/api/docs");
    const files = await response.json();

    docList.innerHTML = "";
    files.forEach((file) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = file.replace(".md", "");
      button.onclick = () => loadDoc(file);
      li.appendChild(button);
      docList.appendChild(li);
    });

    // Load first document if available
    if (files.length > 0) {
      loadDoc(files[0]);
    }
  } catch (error) {
    docList.innerHTML = '<li class="loading">Error loading docs</li>';
    console.error("Error loading docs:", error);
  }
}

// Load and display a specific markdown file
async function loadDoc(filename) {
  try {
    docContent.innerHTML = '<div class="loading">Loading...</div>';
    const response = await fetch(`/api/docs/${filename}`);
    const data = await response.json();

    if (response.ok) {
      docContent.innerHTML = data.html;
      curlFetcher();
    } else {
      docContent.innerHTML = `<p>Error: ${data.error}</p>`;
    }
  } catch (error) {
    docContent.innerHTML = "<p>Error loading document</p>";
    console.error("Error loading document:", error);
  }
}

// Initialize on page load
loadDocsList();

function curlFetcher() {
  const codeBlocks = docContent.querySelectorAll("pre code.language-curl");

  codeBlocks.forEach((block, index) => {
    const curlCommand = block.textContent.trim();
    const preElement = block.parentElement;

    // Create a new playground for each curl block
    const playground = document.createElement("div");
    playground.className = "curlPlaygroundInline";
    playground.innerHTML = `
      <div id="curlPanel-${index}">
        <div class="panelHeader">Request</div>
        <textarea id="curlScript-${index}" class="curlScript" placeholder="Enter curl command...">${curlCommand}</textarea>
        <button id="runButton-${index}" class="runBtn">Run</button>
      </div>
      <div id="responsePanel-${index}">
        <div class="panelHeader">Response</div>
        <div id="curlOutput-${index}" class="curlOutput">
          <div class="outputEmpty">Run a request to see the response</div>
        </div>
      </div>
    `;

    // Replace the pre code block with the playground
    preElement.replaceWith(playground);

    // Set up the run button for this playground
    const runButton = playground.querySelector(`#runButton-${index}`);
    const curlScript = playground.querySelector(`#curlScript-${index}`);
    const curlOutput = playground.querySelector(`#curlOutput-${index}`);

    runButton.onclick = () => {
      const command = curlScript.value;
      runCurlCommand(command, curlOutput);
    };
  });
}

async function runCurlCommand(curlCommand, outputElement) {
  try {
    outputElement.innerHTML = '<div class="outputEmpty">Running...</div>';

    // Parse curl command to extract URL and method
    const urlMatch = curlCommand.match(/curl\s+(?:-[A-Za-z]\s+\S+\s+)*(\S+)/);
    const methodMatch = curlCommand.match(
      /-X\s+(GET|POST|PUT|PATCH|DELETE|HEAD)/i,
    );

    if (!urlMatch) {
      const preElement = document.createElement("pre");
      preElement.textContent = "Error: Could not parse URL from curl command";
      outputElement.innerHTML = "";
      outputElement.appendChild(preElement);
      return;
    }

    const url = urlMatch[1];
    const method = methodMatch ? methodMatch[1].toUpperCase() : "GET";

    // Parse headers from -H flags
    const headers = {};
    const headerMatches = curlCommand.matchAll(/-H\s+["']([^"']+)["']/g);
    for (const match of headerMatches) {
      const [key, ...valueParts] = match[1].split(":");
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join(":").trim();
      }
    }

    // Parse body from -d or --data flags
    let body = "";
    const bodyMatch = curlCommand.match(/(?:-d|--data)\s+["']([^"']+)["']/);
    if (bodyMatch) {
      body = bodyMatch[1];
    }

    // Execute curl command via backend API
    const response = await fetch("/api/run-curl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method, headers, body }),
    });

    const data = await response.json();

    if (data.success) {
      const preElement = document.createElement("pre");
      // Try to prettify if it's JSON
      try {
        const parsed = JSON.parse(data.output);
        preElement.textContent = JSON.stringify(parsed, null, 2);
      } catch {
        // Not JSON, show as plain text
        preElement.textContent = data.output;
      }
      outputElement.innerHTML = "";
      outputElement.appendChild(preElement);
    } else {
      const preElement = document.createElement("pre");
      preElement.textContent = `Error: ${data.error || data.details || "Request failed"}`;
      outputElement.innerHTML = "";
      outputElement.appendChild(preElement);
    }
  } catch (error) {
    const preElement = document.createElement("pre");
    preElement.textContent = `Error: ${error.message}`;
    outputElement.innerHTML = "";
    outputElement.appendChild(preElement);
    console.error("Error running curl:", error);
  }
}
