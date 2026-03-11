import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { NODOCKER_MARKER_PATH, RUNTIME_CHECK_TIMEOUT_MS } from "./constants.js";

export function checkRuntimeAvailable(runtime, execFileCheck = execFile) {
  return new Promise((resolve) => {
    execFileCheck(runtime, ["--version"], { timeout: RUNTIME_CHECK_TIMEOUT_MS }, (error) => {
      resolve(!error);
    });
  });
}

export async function defaultRuntimeResolver(execFileCheck = execFile) {
  if (await checkRuntimeAvailable("podman", execFileCheck)) {
    return "podman";
  }

  if (await checkRuntimeAvailable("docker", execFileCheck)) {
    return "docker";
  }

  throw new Error("No container runtime available. Install podman or docker.");
}

export function createNoDockerEnsurer({
  markerPath = NODOCKER_MARKER_PATH,
  fsAccess = fs.access,
  fsWriteFile = fs.writeFile,
  logger = console,
} = {}) {
  let checked = false;

  return async (runtime) => {
    if (runtime !== "podman" || checked) {
      return;
    }
    checked = true;

    try {
      await fsAccess(markerPath);
      return;
    } catch (error) {
      if (error && error.code && error.code !== "ENOENT") {
        logger.warn(`Unable to inspect ${markerPath}: ${error.message}.`);
      }
    }

    try {
      await fsWriteFile(markerPath, "", { flag: "wx" });
    } catch (error) {
      if (error && error.code === "EEXIST") {
        return;
      }
      logger.warn(
        `Could not create ${markerPath}. To silence podman's Docker emulation warning, run: sudo touch ${markerPath}`,
      );
    }
  };
}
