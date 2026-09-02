#!/usr/bin/env bun
/**
 * Host matrix smoke test.
 *
 * Both supported host families ship an original CLI and a fork, and this repo
 * has to keep working on all four:
 *
 *   pi family    -> `pi`      (original pi-agent)      + `senpi`   (fork)
 *   grok family  -> `grok`    (original GrokBuild)     + `grokomo` (fork)
 *
 * Every CLI that is present on PATH is verified. Absent CLIs are reported as
 * SKIP rather than failing, so a machine with only the forks installed still
 * gets a green run — but a family with no CLI at all fails, because that family
 * would otherwise go silently unverified.
 *
 * Override the probed CLIs with VERIFY_HOSTS_PI_CLIS / VERIFY_HOSTS_GROK_CLIS
 * (comma-separated).
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Result = {
	readonly kind: "PASS" | "SKIP" | "FAIL";
	readonly name: string;
	readonly detail: string;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = resolve(root, "plugins/grok/cliproxy-api-provider");
const syncScript = resolve(pluginPath, "scripts/sync-models.mjs");
const results: Result[] = [];

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
	try {
		return execFileSync(command, [...args], {
			cwd: root,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
		const stdout = e.stdout ? String(e.stdout) : "";
		const stderr = e.stderr ? String(e.stderr) : "";
		throw new Error(`${command} ${args.join(" ")} failed with ${e.status ?? "unknown"}\n${stdout}${stderr}`);
	}
}

function requireIncludes(haystack: string, needle: string, label: string): void {
	if (!haystack.includes(needle)) {
		throw new Error(`${label}: missing ${JSON.stringify(needle)}\n--- output ---\n${haystack.slice(0, 4000)}`);
	}
}

function requireSectionValue(toml: string, section: string, key: string, expected: string): void {
	const header = `[${section}]`;
	const start = toml.indexOf(header);
	if (start === -1) throw new Error(`missing TOML section ${header}`);
	const rest = toml.slice(start + header.length);
	const next = rest.search(/\n\[[^\n]+\]/);
	const body = next === -1 ? rest : rest.slice(0, next);
	const line = `${key} = ${expected}`;
	if (!body.includes(line)) {
		throw new Error(`${header}: expected ${line}\n--- section ---\n${body.trim()}`);
	}
}

function record(kind: Result["kind"], name: string, detail: string): void {
	results.push({ kind, name, detail });
}

/** Run one named check, converting a thrown assertion into a FAIL result. */
function check(name: string, fn: () => string): void {
	try {
		record("PASS", name, fn());
	} catch (error) {
		record("FAIL", name, error instanceof Error ? error.message : String(error));
	}
}

function findOnPath(command: string): string | undefined {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		const candidate = join(dir, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
		}
	}
	return undefined;
}

function cliList(envVar: string, fallback: readonly string[]): readonly string[] {
	const raw = process.env[envVar];
	if (!raw) return fallback;
	return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// pi family: pi-agent and its Senpi fork
// ---------------------------------------------------------------------------

/** Model rows the extension must expose identically on every pi-family CLI. */
const PI_MODEL_EXPECTATIONS = [
	{ query: "gpt-5.5", needles: ["cliproxy", "gpt-5.5", "272K", "128K"], detail: "272K context / 128K output" },
	{ query: "gpt-5.6-terra", needles: ["cliproxy", "gpt-5.6-terra", "921K", "128K"], detail: "921K input context / 128K output" },
	{ query: "grok-build", needles: ["cliproxy", "grok-build-0.1", "256K", "no"], detail: "256K context, reasoning disabled" },
] as const;

function verifyPiCli(cli: string): void {
	for (const { query, needles, detail } of PI_MODEL_EXPECTATIONS) {
		check(`${cli} ${query}`, () => {
			const output = run(cli, ["--list-models", query, "--provider", "cliproxy", "--offline"]);
			for (const needle of needles) requireIncludes(output, needle, `${cli} ${query}`);
			return `cliproxy model metadata loaded with ${detail}`;
		});
	}
}

// ---------------------------------------------------------------------------
// grok family: GrokBuild and its Grokomo fork
// ---------------------------------------------------------------------------

function verifyGrokCli(cli: string): void {
	check(`${cli} plugin validate`, () => {
		const output = run(cli, ["plugin", "validate", pluginPath]);
		requireIncludes(output, "Plugin manifest is valid", `${cli} plugin validation`);
		requireIncludes(output, "cliproxy-api-provider", `${cli} plugin name`);
		return "source plugin manifest is accepted by this plugin loader";
	});

	check(`${cli} plugin list`, () => {
		const output = run(cli, ["plugin", "list"]);
		requireIncludes(output, "cliproxy-api-provider", `${cli} installed plugin list`);
		return "installed plugin registry includes cliproxy-api-provider";
	});
}

function configuredBaseUrl(): string | undefined {
	if (process.env.CLIPROXY_BASE_URL) return process.env.CLIPROXY_BASE_URL;
	for (const homeDir of [".grok", ".grokomo"]) {
		const configPath = join(homedir(), homeDir, "config.toml");
		if (!existsSync(configPath)) continue;
		const match = readFileSync(configPath, "utf8").match(/^models_base_url\s*=\s*["']([^"']+)["']/m);
		if (match) return match[1];
	}
	return undefined;
}

/**
 * Composition smoke for the grok family. Runs once per invocation: sync-models
 * is a plain node script shared by every grok-family CLI, so the generated TOML
 * does not depend on which CLI is installed.
 */
function verifyGrokComposition(): void {
	const baseUrl = configuredBaseUrl();
	if (!baseUrl) throw new Error("grok composition smoke needs CLIPROXY_BASE_URL or ~/.grok/config.toml [endpoints].models_base_url");
	const requestedRoot = process.env.VERIFY_HOSTS_SMOKE_DIR;
	const smokeRoot = requestedRoot || mkdtempSync(join(tmpdir(), "cliproxy-verify-hosts-"));
	const ownsSmokeRoot = !requestedRoot;
	const home = join(smokeRoot, "home");
	const configPath = join(smokeRoot, "config.toml");
	const userConfigPath = join(smokeRoot, "config.user.toml");
	const managedTomlPath = join(smokeRoot, "cliproxy-models.managed.toml");
	const catalogPath = join(smokeRoot, "model-catalog.json");

	try {
		mkdirSync(smokeRoot, { recursive: true });
		writeFileSync(userConfigPath, '[plugins]\nenabled = ["grokomo"]\n');
		// This deliberately disagrees with the effective cap: the generated output must win at 921K.
		writeFileSync(catalogPath, JSON.stringify({ models: { "gpt-5.6-terra": { contextWindow: 1_050_000 } } }));
		run(findOnPath("node") ?? process.execPath, [syncScript, "--force"], {
			...process.env,
			HOME: home,
			CLIPROXY_BASE_URL: baseUrl,
			GROK_CONFIG: configPath,
			GROK_USER_CONFIG: userConfigPath,
			CLIPROXY_MANAGED_TOML: managedTomlPath,
			MODEL_CATALOG: catalogPath,
			GROK_PLUGIN_DATA: join(smokeRoot, "plugin-data"),
		});

		const managedToml = readFileSync(managedTomlPath, "utf8");
		const activeToml = readFileSync(configPath, "utf8");
		for (const [label, toml] of [["managed TOML", managedToml], ["active GROK_CONFIG", activeToml]] as const) {
			requireSectionValue(toml, 'model."gpt-5.6-terra"', "context_window", "921000");
			record("PASS", `grok-family ${label}`, `${label} contains gpt-5.6-terra at 921K`);
		}
		requireSectionValue(activeToml, "plugins", "enabled", '["grokomo", "cliproxy-api-provider"]');
		if (requestedRoot) record("PASS", "grok-family smoke artifacts", smokeRoot);
	} finally {
		if (ownsSmokeRoot) rmSync(smokeRoot, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Matrix driver
// ---------------------------------------------------------------------------

type Family = {
	readonly label: string;
	readonly clis: readonly string[];
	readonly verifyCli: (cli: string) => void;
	readonly shared?: { readonly name: string; readonly run: () => void; readonly detail: string };
};

const families: readonly Family[] = [
	{
		label: "pi family (pi-agent + Senpi fork)",
		clis: cliList("VERIFY_HOSTS_PI_CLIS", ["senpi", "pi"]),
		verifyCli: verifyPiCli,
	},
	{
		label: "grok family (GrokBuild + Grokomo fork)",
		clis: cliList("VERIFY_HOSTS_GROK_CLIS", ["grokomo", "grok"]),
		verifyCli: verifyGrokCli,
		shared: {
			name: "grok-family model sync",
			run: verifyGrokComposition,
			detail: "non-dry-run composition proves Terra at 921K in managed and active TOML",
		},
	},
];

let familyMissing = false;

for (const family of families) {
	const present = family.clis.filter((cli) => findOnPath(cli) !== undefined);
	for (const cli of family.clis) {
		if (present.includes(cli)) continue;
		record("SKIP", cli, `not installed on PATH; ${family.label} verified through ${present.join(", ") || "nothing"}`);
	}

	if (present.length === 0) {
		familyMissing = true;
		record("FAIL", family.label, `no CLI from this family is installed (looked for: ${family.clis.join(", ")})`);
		continue;
	}

	for (const cli of present) {
		check(`${cli} version`, () => run(cli, ["--version"]).trim().split("\n")[0] ?? "unknown");
		family.verifyCli(cli);
	}

	if (family.shared) {
		const { name, run: runShared, detail } = family.shared;
		check(name, () => {
			runShared();
			return detail;
		});
	}
}

for (const result of results) {
	console.log(`${result.kind} ${result.name}: ${result.detail}`);
}

const failed = results.filter((result) => result.kind === "FAIL");
if (failed.length > 0) {
	console.error(`\n${failed.length} host check(s) failed.`);
	process.exit(1);
}
if (familyMissing) process.exit(1);
