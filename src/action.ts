// What Anthivo's GitHub Action does with its inputs, apart from running anything: pure, so it's tested on its own.
//
// The Action is a thin wrapper around the anthivo CLI. It installs the CLI at an exact version, runs `anthivo run` with
// the token in the CLI's environment (never as an argument, and masked in the log), and fails the job on the CLI's exit
// 1 (a new defect at or above fail-on) or 2 (it couldn't start, the run errored, or the failures weren't judged). The
// CLI does the rest, the same way in any CI: it skips a pull request from a fork unless told to run it, records the pull
// request's head commit rather than the merge commit the job checks out, fetches the one commit a shallow checkout
// needs to find the changed files (only their names are ever sent), and writes the job's summary. No AMI logic and no
// AI model key are anywhere near the job.

/** The CLI version this Action was tested with: the one it runs unless the workflow names another exact version. */
export const PINNED_CLI_VERSION = "0.1.0";

export const DEFAULT_SERVER = "https://www.anthivo.com";

/** An exact version as npm publishes them: never a range, a tag such as latest, a path, a tarball or an address. */
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/** The booleans GitHub's own toolkit takes for an input. */
const TRUE = ["true", "True", "TRUE"];
const FALSE = ["false", "False", "FALSE"];

/** A workflow's input the Action can't use: said in the Action's own words, and the job fails. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export interface Inputs {
  token: string;
  project: string | null;
  environment: string | null;
  url: string | null;
  failOn: string | null;
  runOnForks: boolean;
  server: string;
  cliVersion: string;
}

type Env = Record<string, string | undefined>;

/** An input as GitHub's runner hands it to an action: INPUT_ and its name in capitals, spaces as underscores. */
export const inputOf = (env: Env, name: string) => (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();

export function readInputs(env: Env): Inputs {
  const cliVersion = inputOf(env, "cli-version") || PINNED_CLI_VERSION;
  if (!EXACT_VERSION.test(cliVersion)) {
    throw new InputError(
      `cli-version must be an exact version of the anthivo CLI, like ${PINNED_CLI_VERSION}: never a range, a tag such as latest, or a path.`,
    );
  }
  const forks = inputOf(env, "run-on-forks") || "false";
  if (!TRUE.includes(forks) && !FALSE.includes(forks)) {
    throw new InputError("run-on-forks takes true or false.");
  }
  return {
    token: inputOf(env, "token"),
    project: inputOf(env, "project") || null,
    environment: inputOf(env, "environment") || null,
    url: inputOf(env, "url") || null,
    failOn: inputOf(env, "fail-on") || null,
    runOnForks: TRUE.includes(forks),
    server: inputOf(env, "server") || DEFAULT_SERVER,
    cliVersion,
  };
}

/**
 * `anthivo run`'s arguments: the options the inputs give, the one base commit fetched for a shallow checkout, and the
 * job's summary file. Never the token: the CLI refuses one as an argument, and it would show in the runner's process
 * list.
 */
export function cliArguments(inputs: Inputs, summaryFile: string | undefined): string[] {
  const args = ["run", "--fetch-base"];
  if (inputs.project) args.push("--project", inputs.project);
  if (inputs.environment) args.push("--env", inputs.environment);
  if (inputs.url) args.push("--url", inputs.url);
  if (inputs.failOn) args.push("--fail-on", inputs.failOn);
  if (inputs.runOnForks) args.push("--forks");
  if (summaryFile) args.push("--markdown", summaryFile);
  return args;
}

/**
 * The CLI's environment: the job's own (GitHub's variables say where the run comes from), without the Action's inputs,
 * with the token and the server the CLI reads. A token given anywhere else in the job's environment is replaced.
 */
export function cliEnvironment(env: Env, inputs: Inputs): Env {
  const next: Env = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("INPUT_") && name !== "ANTHIVO_TOKEN" && name !== "ANTHIVO_URL") next[name] = value;
  }
  if (inputs.token) next.ANTHIVO_TOKEN = inputs.token;
  next.ANTHIVO_URL = inputs.server;
  return next;
}

/** npm's environment: the job's, without the Action's inputs, so the token never reaches it. */
export function installEnvironment(env: Env): Env {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("INPUT_") && name !== "ANTHIVO_TOKEN"),
  );
}

/** npm's arguments: the CLI at its exact version, into a folder of its own, with no install scripts and no lockfile. */
export function installArguments(version: string, prefix: string): string[] {
  return [
    "install",
    "--prefix",
    prefix,
    "--no-save",
    "--no-package-lock",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--loglevel=error",
    `anthivo@${version}`,
  ];
}

/** The job's result from the CLI's exit code: 0 passes; 1 and 2 fail, and anything else counts as 2. */
export function jobExitCode(code: number | null): 0 | 1 | 2 {
  if (code === 0) return 0;
  if (code === 1) return 1;
  return 2;
}

/** How the job ended, as an annotation on the run's page, in the Action's own words (never the server's text). */
export function resultAnnotation(code: 0 | 1 | 2): string | null {
  if (code === 1) return "::error title=Anthivo::A new defect at or above fail-on. The job summary lists it.";
  if (code === 2) return "::error title=Anthivo::The check ended without a verdict. The log says why.";
  return null;
}

/** What the installed CLI's package.json says: its version, and the file its `anthivo` command runs. */
export function installedBin(manifest: unknown, version: string): string {
  const { name, version: installed, bin } = (manifest ?? {}) as { name?: unknown; version?: unknown; bin?: unknown };
  if (name !== "anthivo" || installed !== version) {
    throw new InputError(`npm installed something other than anthivo@${version}.`);
  }
  const path = typeof bin === "string" ? bin : (bin as Record<string, unknown> | undefined)?.anthivo;
  if (typeof path !== "string" || path.startsWith("/") || path.includes("..") || /^[A-Za-z]:/.test(path)) {
    throw new InputError(`anthivo@${version} has no anthivo command.`);
  }
  return path;
}
