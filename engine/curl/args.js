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
  ];

  for (const header of spec.headers) {
    args.push("-H", `${header.name}: ${header.value}`);
  }

  if (spec.body) {
    args.push("--data-raw", spec.body);
  }

  return args;
}
