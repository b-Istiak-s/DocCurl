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
    // Execute curl command via backend API
    const response = await fetch("/api/curl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: curlCommand }),
    });
    const data = await response.json();
    outputElement.innerHTML = `<pre>${data.output}</pre>`;
  } catch (error) {
    outputElement.innerHTML = `<pre>Error: ${error.message}</pre>`;
    console.error("Error running curl:", error);
  }
}
