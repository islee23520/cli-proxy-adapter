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
  response.end(JSON.stringify({ data: [{ id: "gpt-5.4-mini-fast" }, { id: "gpt-5.6-terra" }] }));
});
server.listen(0, "127.0.0.1", () => console.log("http://127.0.0.1:" + server.address().port + "/v1"));`,
	], { stdout: "pipe", stderr: "pipe" });
	servers.push(fixture);
	const { value, done } = await fixture.stdout.getReader().read();
	if (done || !value) throw new Error("model fixture exited before reporting its URL");
	return new TextDecoder().decode(value).trim();
}

async function writeHostCommand(path: string): Promise<void> {
	await writeFile(path, `#!/bin/sh
printf '%s|%s|%s\\n' "$(basename "$0")" "$GROK_HOME" "$*" >> "$INSTALL_LOG"
exit 0
`);
	await chmod(path, 0o755);
}

test("install-all installs every available host into its own home", async () => {
	const sandbox = await mkdtemp(join(tmpdir(), "cliproxy-install-all-"));
	sandboxes.push(sandbox);
	const bin = join(sandbox, "bin");
	const log = join(sandbox, "install.log");
	await mkdir(bin, { recursive: true });
	for (const cli of ["senpi", "pi", "grokomo", "grok"]) await writeHostCommand(join(bin, cli));
	const baseUrl = await startModelFixture();
	const proxyRoot = baseUrl.replace(/\/v1$/, "");

	execFileSync("bash", ["scripts/install-all.sh"], {
		cwd: join(import.meta.dir, ".."),
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${bin}:${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
			HOME: sandbox,
			INSTALL_LOG: log,
			CLIPROXY_URL: proxyRoot,
			CLIPROXY_BASE_URL: "",
		},
	});

	const calls = await readFile(log, "utf8");
	expect(calls).toContain("senpi||install ");
	expect(calls).toContain("pi||install ");
	expect(calls).toContain(`grokomo|${join(sandbox, ".grokomo")}|plugin install `);
	expect(calls).toContain(`grok|${join(sandbox, ".grok")}|plugin install `);
	for (const homeDir of [".grokomo", ".grok"]) {
		const config = await readFile(join(sandbox, homeDir, "config.toml"), "utf8");
		expect(config).toContain(`models_base_url = "${baseUrl}"`);
		expect(config).toContain('"cliproxy-api-provider"');
		expect(config).toContain('[model."gpt-5.4-mini-fast"]');
		expect(config).toContain("context_window = 400000");
	}
});
