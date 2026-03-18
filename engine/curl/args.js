import {
  CURL_RESPONSE_META_END,
  CURL_RESPONSE_META_START,
} from "./constants.js";

export function buildCurlArgs(spec) {
  const args = [
    "-sS",
    "--proto",
    "=http,https",
    "--max-redirs",
    "0",
    "--connect-timeout",
    "4",
    "--max-time",
    "5",
    "-X",
    spec.method,
    spec.url,
    "--write-out",
    `${CURL_RESPONSE_META_START}%{http_code}\t%{content_type}\t%{time_total}${CURL_RESPONSE_META_END}`,
  ];

  for (const header of spec.headers) {
    args.push("-H", `${header.name}: ${header.value}`);
  }

  if (spec.body) {
    args.push("--data-raw", spec.body);
  }

  for (const formPart of spec.formParts || []) {
    if (formPart.source === "generated" || formPart.source === "upload") {
      const filePath =
        typeof formPart.filePath === "string" && formPart.filePath
          ? formPart.filePath
          : formPart.filename;
      args.push("-F", `${formPart.name}=@${filePath}`);
      continue;
    }

    args.push("-F", `${formPart.name}=${formPart.value}`);
  }

  return args;
}
