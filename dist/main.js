import { runAction } from "./run.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Anthivo's GitHub Action, as the runner starts it (`runs.main` in action.yml): the steps in run.ts with the real job
// around them. npm installs the CLI into the runner's temporary folder, and Node runs it with the job's checkout as its
// folder. Its output, both streams, goes to the log through this process, after the line that stops workflow commands.
// `realDependencies` is that real job, exported so a test can check it (the word that resumes workflow commands above
// all); the Action runs only when the runner starts this file.
const windows = process.platform === "win32";
/** On Windows, npm is a .cmd file, which only cmd.exe runs: one command line, each argument quoted unless it's plain. */
const forCmd = (arg) => (/^[A-Za-z0-9@._=:\\/-]+$/.test(arg) ? arg : `"${arg}"`);
function exitOf(command, args, options, output) {
    return new Promise((resolve) => {
        const child = spawn(command, args, options);
        child.stdout?.on("data", (chunk) => output?.(chunk));
        child.stderr?.on("data", (chunk) => output?.(chunk));
        child.on("error", () => resolve(null));
        child.on("close", (code) => resolve(code));
    });
}
export const realDependencies = () => ({
    env: process.env,
    log: (text) => {
        process.stdout.write(text);
    },
    write: (chunk) => {
        process.stdout.write(chunk);
    },
    randomWord: () => `anthivo-${randomUUID()}`,
    folder: (version) => {
        const folder = join(process.env.RUNNER_TEMP || tmpdir(), `anthivo-cli-${version}`);
        mkdirSync(folder, { recursive: true });
        return folder;
    },
    npm: (args, cwd, env) => {
        const options = { cwd, env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true };
        if (!windows)
            return exitOf("npm", args, options);
        // cmd.exe would expand a % and can't take a quote inside quotes: such a folder isn't used.
        if (args.some((arg) => /["%]/.test(arg)))
            return Promise.resolve(null);
        return exitOf(["npm.cmd", ...args.map(forCmd)].join(" "), [], { ...options, shell: true });
    },
    readManifest: (prefix) => {
        try {
            return JSON.parse(readFileSync(join(prefix, "node_modules", "anthivo", "package.json"), "utf8"));
        }
        catch {
            return null;
        }
    },
    cli: (file, args, env, cwd, output) => exitOf(process.execPath, [file, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }, output),
});
/** Whether the runner started this file (`node dist/main.js`), rather than a test importing it: both paths resolved. */
function startedByRunner() {
    const started = process.argv[1];
    if (started === undefined)
        return false;
    try {
        return realpathSync.native(started) === realpathSync.native(fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (startedByRunner())
    process.exitCode = await runAction(realDependencies());
