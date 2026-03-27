import test from "node:test";
import assert from "node:assert/strict";

import {
  detectImportFormat,
  parseImportedCollections,
  renderCollectionsToMarkdown,
} from "../../core/import/index.js";

function createRequest(name, overrides = {}) {
  return {
    name,
    method: "GET",
    url: "$BASE_URL/example",
    headers: [],
    queryParams: [],
    pathParams: [],
    bodyFields: [],
    formFields: [],
    rawBody: "",
    curlSpec: {
      method: "GET",
      url: "$BASE_URL/example",
      headers: [],
      body: "",
      formParts: [],
    },
    ...overrides,
  };
}

test("detectImportFormat recognizes native and DocCurl export payloads", () => {
  assert.equal(
    detectImportFormat({
      info: {
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
    }),
    "postman",
  );
  assert.equal(
    detectImportFormat({
      _type: "export",
      resources: [],
    }),
    "insomnia",
  );
  assert.equal(
    detectImportFormat({
      collections: [],
    }),
    "hoppscotch",
  );
  assert.equal(
    detectImportFormat({
      v: "2",
      name: "Workspace",
      folders: [],
      requests: [],
    }),
    "hoppscotch",
  );
  assert.equal(
    detectImportFormat({
      format: "postman",
      collection: {},
    }),
    "postman",
  );
});

test("parseImportedCollections preserves nested Postman folders and normalizes variables", () => {
  const [collection] = parseImportedCollections({
    info: {
      name: "Platform",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [
      {
        name: "Health",
        request: {
          method: "GET",
          url: {
            raw: "{{BASE_URL}}/health?tenant={{TENANT}}",
          },
          header: [
            {
              key: "Authorization",
              value: "Bearer {{TOKEN}}",
            },
          ],
        },
      },
      {
        name: "Admin/Auth",
        item: [
          {
            name: "Create User",
            request: {
              method: "POST",
              url: "{{BASE_URL}}/admins/:adminId/users",
              body: {
                mode: "raw",
                raw: '{"user":{"email":"{{EMAIL}}"}}',
              },
            },
          },
        ],
      },
    ],
  });

  assert.equal(collection.name, "Platform");
  assert.equal(collection.rootFolder.requests[0].url, "$BASE_URL/health?tenant=$TENANT");
  assert.equal(collection.rootFolder.requests[0].headers[0].value, "Bearer $TOKEN");

  const adminFolder = collection.rootFolder.folders.find((folder) => folder.name === "Admin");
  assert.ok(adminFolder);
  const authFolder = adminFolder.folders.find((folder) => folder.name === "Auth");
  assert.ok(authFolder);
  assert.equal(authFolder.requests[0].pathParams[0].name, "adminId");
  assert.deepEqual(authFolder.requests[0].bodyFields, [{ name: "user.email" }]);
});

test("parseImportedCollections interprets DocCurl Insomnia export group names as nested folders", () => {
  const [collection] = parseImportedCollections({
    format: "insomnia",
    resources: [
      {
        _id: "wrk_1",
        _type: "workspace",
        name: "DocCurl Export",
      },
      {
        _id: "grp_1",
        _type: "request_group",
        parentId: "wrk_1",
        name: "auth/admin.md",
      },
      {
        _id: "req_1",
        _type: "request",
        parentId: "grp_1",
        name: "Create Admin",
        method: "POST",
        url: "{{ _.BASE_URL }}/admins",
        headers: [
          {
            name: "X-Tenant",
            value: "{{ _.TENANT }}",
          },
        ],
        body: {
          mimeType: "multipart/form-data",
          params: [
            {
              name: "avatar",
              type: "file",
              fileName: "avatar.png",
            },
          ],
        },
      },
    ],
  });

  const authFolder = collection.rootFolder.folders.find((folder) => folder.name === "auth");
  assert.ok(authFolder);
  const adminFolder = authFolder.folders.find((folder) => folder.name === "admin");
  assert.ok(adminFolder);
  assert.equal(adminFolder.requests[0].url, "$BASE_URL/admins");
  assert.equal(adminFolder.requests[0].headers[0].value, "$TENANT");
  assert.deepEqual(adminFolder.requests[0].formFields, [{ name: "avatar" }]);
});

test("parseImportedCollections supports DocCurl Postman and Hoppscotch export wrappers", () => {
  const [postmanCollection] = parseImportedCollections({
    format: "postman",
    collection: {
      info: {
        name: "DocCurl Export",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: [
        {
          name: "billing/invoices.md",
          item: [
            {
              name: "List Invoices",
              request: {
                method: "GET",
                url: {
                  raw: "{{BASE_URL}}/invoices",
                },
                header: [],
              },
            },
          ],
        },
      ],
    },
  });

  const billingFolder = postmanCollection.rootFolder.folders.find((folder) => folder.name === "billing");
  assert.ok(billingFolder);
  const invoicesFolder = billingFolder.folders.find((folder) => folder.name === "invoices");
  assert.ok(invoicesFolder);
  assert.equal(invoicesFolder.requests[0].name, "List Invoices");

  const [hoppscotchCollection] = parseImportedCollections({
    format: "hoppscotch",
    collections: [
      {
        name: "DocCurl Export",
        requests: [],
        folders: [
          {
            name: "orders/history.md",
            requests: [
              {
                name: "History",
                method: "GET",
                endpoint: "{{BASE_URL}}/orders/history",
                headers: [],
                body: { contentType: "text/plain", body: "", form: [] },
              },
            ],
            folders: [],
          },
        ],
      },
    ],
  });

  const ordersFolder = hoppscotchCollection.rootFolder.folders.find((folder) => folder.name === "orders");
  assert.ok(ordersFolder);
  const historyFolder = ordersFolder.folders.find((folder) => folder.name === "history");
  assert.ok(historyFolder);
  assert.equal(historyFolder.requests[0].url, "$BASE_URL/orders/history");
});

test("parseImportedCollections preserves Hoppscotch root requests and nested folders", () => {
  const [collection] = parseImportedCollections({
    collections: [
      {
        name: "Workspace",
        requests: [
          {
            name: "Ping",
            method: "GET",
            endpoint: "{{BASE_URL}}/ping",
            headers: [],
            body: {
              contentType: "text/plain",
              body: "",
              form: [],
            },
          },
        ],
        folders: [
          {
            name: "Reports/Monthly",
            requests: [
              {
                name: "Upload Statement",
                method: "POST",
                endpoint: "{{BASE_URL}}/reports",
                headers: [],
                body: {
                  contentType: "multipart/form-data",
                  body: "",
                  form: [
                    {
                      active: true,
                      key: "statement",
                      value: "/tmp/statement.pdf",
                      isFile: true,
                    },
                  ],
                },
              },
            ],
            folders: [],
          },
        ],
      },
    ],
  });

  assert.equal(collection.rootFolder.requests[0].url, "$BASE_URL/ping");
  const reportsFolder = collection.rootFolder.folders.find((folder) => folder.name === "Reports");
  assert.ok(reportsFolder);
  const monthlyFolder = reportsFolder.folders.find((folder) => folder.name === "Monthly");
  assert.ok(monthlyFolder);
  assert.deepEqual(monthlyFolder.requests[0].formFields, [{ name: "statement" }]);
});

test("parseImportedCollections supports native Hoppscotch collection exports", () => {
  const [collection] = parseImportedCollections({
    v: "2",
    name: "Workspace",
    requests: [
      {
        v: "6",
        name: "Ping",
        method: "GET",
        endpoint: "<<BASE_URL>>/ping",
        params: [{ key: "tenant", value: "<<TENANT>>", active: true }],
        headers: [],
        body: {
          contentType: "text/plain",
          body: "",
        },
      },
    ],
    folders: [],
  });

  assert.equal(collection.name, "Workspace");
  assert.equal(collection.rootFolder.requests[0].url, "$BASE_URL/ping?tenant=%24TENANT");
});

test("renderCollectionsToMarkdown generates folder files and large-folder request files", () => {
  const outputs = renderCollectionsToMarkdown([
    {
      name: "Workspace",
      rootFolder: {
        name: "Workspace",
        requests: [],
        folders: [
          {
            name: "Auth",
            requests: [
              createRequest("Login", {
                queryParams: [{ name: "tenant" }],
                headers: [{ name: "Authorization", value: "Bearer $TOKEN" }],
              }),
              createRequest("Logout"),
            ],
            folders: [],
          },
          {
            name: "Reports",
            requests: Array.from({ length: 8 }, (_, index) =>
              createRequest(`Report ${index + 1}`),
            ),
            folders: [],
          },
        ],
      },
    },
  ]);

  const outputPaths = outputs.map((entry) => entry.path).sort();
  assert.ok(outputPaths.includes("workspace/auth.md"));
  assert.ok(outputPaths.includes("workspace/reports/index.md"));
  assert.ok(outputPaths.includes("workspace/reports/report-1.md"));

  const authFile = outputs.find((entry) => entry.path === "workspace/auth.md");
  assert.match(authFile.content, /^# Auth/m);
  assert.match(authFile.content, /^## Login/m);
  assert.match(authFile.content, /^### Query Params/m);
  assert.match(authFile.content, /^\| Name \| Requirement \|$/m);
  assert.match(authFile.content, /^```curl$/m);
});

test("renderCollectionsToMarkdown expands curl code fences when imported content contains backticks", () => {
  const outputs = renderCollectionsToMarkdown([
    {
      name: "Workspace",
      rootFolder: {
        name: "Workspace",
        requests: [
          createRequest("Fence Breakout Attempt", {
            curlSpec: {
              method: "POST",
              url: "$BASE_URL/upload",
              headers: [],
              body: "alpha\n```\n## Injected Heading",
              formParts: [],
            },
          }),
        ],
        folders: [],
      },
    },
  ]);

  const workspaceFile = outputs.find((entry) => entry.path === "workspace/workspace.md");
  assert.ok(workspaceFile);
  assert.match(workspaceFile.content, /^````curl$/m);
  assert.match(workspaceFile.content, /## Injected Heading/);
  assert.match(workspaceFile.content, /^````$/m);
});
