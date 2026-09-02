import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const sandboxes: string[] = [];
const servers: ReturnType<typeof Bun.spawn>[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) server.kill();
	await Promise.all(sandboxes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function startModelFixture(): Promise<string> {
	const fixture = Bun.spawn([
		process.execPath,
		"-e",
		`const http = require("node:http");
const server = http.createServer((request, response) => {
  if (request.url !== "/v1/models") return response.writeHead(404).end();
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ data: [{ id: "gpt-5.4" }, { id: "gpt-5.4-mini" }, { id: "gpt-5.5" }, { id: "gpt-5.6-sol" }, { id: "gpt-5.6-terra" }, { id: "grok-3-mini-fast" }] }));
});
server.listen(0, "127.0.0.1", () => console.log("http://127.0.0.1:" + server.address().port + "/v1"));`,
	], { stdout: "pipe", stderr: "pipe" });
	servers.push(fixture);
	const { value, done } = await fixture.stdout.getReader().read();
	if (done || !value) throw new Error("model fixture exited before reporting its URL");
	return new TextDecoder().decode(value).trim();
}

async function writeCommand(path: string, output: string): Promise<void> {
	await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
	await chmod(path, 0o755);
}

function section(toml: string, name: string): string {
	const header = `[${name}]`;
	const start = toml.indexOf(header);
	expect(start, `missing ${header}`).toBeGreaterThanOrEqual(0);
	const rest = toml.slice(start + header.length);
	const next = rest.search(/\n\[/);
	return next === -1 ? rest : rest.slice(0, next);
}

test("verify-hosts composes active metadata from a faithful isolated model fixture on all four hosts", async () => {
	const sandbox = await mkdtemp(join(tmpdir(), "cliproxy-verify-hosts-"));
	sandboxes.push(sandbox);
	const bin = join(sandbox, "bin");
	await mkdir(bin, { recursive: true });
	const piFamilyOutput = "cliproxy gpt-5.5 272K 128K\ncliproxy gpt-5.6-terra 921K 128K\ncliproxy grok-build-0.1 256K no";
	const grokFamilyOutput = "Plugin manifest is valid: cliproxy-api-provider";
	await writeCommand(join(bin, "senpi"), piFamilyOutput);
	await writeCommand(join(bin, "pi"), piFamilyOutput);
	await writeCommand(join(bin, "grokomo"), grokFamilyOutput);
	await writeCommand(join(bin, "grok"), grokFamilyOutput);
	const baseUrl = await startModelFixture();
	const smokeDir = join(sandbox, "grokomo-smoke");
	const managed = join(smokeDir, "cliproxy-models.managed.toml");
	const config = join(smokeDir, "config.toml");

	const output = execFileSync(process.execPath, ["scripts/verify-hosts.ts"], {
		cwd: join(import.meta.dir, ".."),
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			HOME: sandbox,
			CLIPROXY_BASE_URL: baseUrl,
			VERIFY_HOSTS_SMOKE_DIR: smokeDir,
		},
	});

	expect(output).toContain("PASS senpi gpt-5.6-terra");
	expect(output).toContain("PASS pi gpt-5.6-terra");
	expect(output).toContain("PASS grokomo plugin validate");
	expect(output).toContain("PASS grok plugin validate");
	expect(output).toContain("PASS grok-family model sync");
	expect(output).not.toContain("FAIL");
	const [managedToml, activeToml] = await Promise.all([readFile(managed, "utf8"), readFile(config, "utf8")]);
	for (const toml of [managedToml, activeToml]) {
		expect(section(toml, 'model."gpt-5.4"')).toContain("context_window = 272000");
		expect(section(toml, 'model."gpt-5.4-mini"')).toContain("context_window = 400000");
		expect(section(toml, 'model."gpt-5.5"')).toContain("context_window = 272000");
		expect(section(toml, 'model."gpt-5.6-sol"')).toContain("context_window = 921000");
		expect(section(toml, 'model."gpt-5.6-terra"')).toContain("context_window = 921000");
		// Real vendor id, not a tier alias: the -fast effort default must stay "high".
		expect(section(toml, 'model."grok-3-mini-fast"')).toContain('reasoning_effort = "high"');
	}
	expect(section(activeToml, "plugins")).toContain('"cliproxy-api-provider"');
});

test("verify-hosts skips absent original CLIs on a fork-only machine without failing", async () => {
	const sandbox = await mkdtemp(join(tmpdir(), "cliproxy-verify-hosts-forkonly-"));
	sandboxes.push(sandbox);
	const bin = join(sandbox, "bin");
	await mkdir(bin, { recursive: true });
	await writeCommand(join(bin, "senpi"), "cliproxy gpt-5.5 272K 128K\ncliproxy gpt-5.6-terra 921K 128K\ncliproxy grok-build-0.1 256K no");
	await writeCommand(join(bin, "grokomo"), "Plugin manifest is valid: cliproxy-api-provider");
	const baseUrl = await startModelFixture();

	const output = execFileSync(process.execPath, ["scripts/verify-hosts.ts"], {
		cwd: join(import.meta.dir, ".."),
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${bin}:${dirname(process.execPath)}`,
			HOME: sandbox,
			CLIPROXY_BASE_URL: baseUrl,
			VERIFY_HOSTS_PI_CLIS: "senpi,pi",
			VERIFY_HOSTS_GROK_CLIS: "grokomo,grok",
		},
	});

	expect(output).toContain("PASS senpi gpt-5.5");
	expect(output).toContain("PASS grokomo plugin validate");
	expect(output).toContain("SKIP pi");
	expect(output).toContain("SKIP grok");
	expect(output).not.toContain("FAIL");
});
