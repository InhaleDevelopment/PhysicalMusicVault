const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const root = __dirname;
const port = Number(process.env.VAULT_PORT || 8787);
const url = `http://localhost:${port}/`;
const agentPath = path.join(root, "vault-agent.js");
const statusPath = path.join(root, "agent-status.json");
const stopRequestPath = path.join(root, "vault-stop.request");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestVault(method = "GET", pathname = "/api/vault", timeoutMs = 1500) {
  return new Promise(resolve => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      timeout: timeoutMs
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        let payload = null;
        try { payload = JSON.parse(body); } catch {}
        resolve({ ok: response.statusCode === 200, statusCode: response.statusCode, payload });
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve({ ok: false, statusCode: 0, payload: null }));
    request.end();
  });
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(statusPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function stopKnownProcess(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0 || numericPid === process.pid) return;
  try { process.kill(numericPid, "SIGTERM"); } catch {}
}

async function waitForState(shouldBeRunning, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await requestVault();
    if (state.ok === shouldBeRunning) return state;
    await delay(500);
  }
  return requestVault();
}

async function stopVault(currentState) {
  console.log("Turning Physical Music Vault off...");
  fs.writeFileSync(stopRequestPath, new Date().toISOString(), "utf8");
  await requestVault("POST", "/api/shutdown");

  let finalState = await waitForState(false, 12);
  if (finalState.ok) {
    const reported = currentState?.payload?.systemHealth?.vaultAgent || readStatus();
    stopKnownProcess(reported.agentPid);
    stopKnownProcess(reported.serverPid);
    finalState = await waitForState(false, 8);
  }

  try { fs.unlinkSync(stopRequestPath); } catch {}
  if (finalState.ok) throw new Error("The dashboard did not stop. Close this window and try the switch again.");
  console.log("Physical Music Vault is OFF.");
}

async function startVault() {
  console.log("Turning Physical Music Vault on...");
  try { fs.unlinkSync(stopRequestPath); } catch {}

  const child = spawn(process.execPath, [agentPath], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      VAULT_PORT: String(port),
      VAULT_DISABLE_WEB: "0"
    }
  });
  child.unref();

  const state = await waitForState(true, 30);
  if (!state.ok) {
    const status = readStatus();
    throw new Error(status.lastError || "The dashboard did not start within 15 seconds.");
  }

  console.log("Physical Music Vault is ON.");
  console.log(`Opening ${url}`);
  if (!/^(1|true|yes)$/i.test(String(process.env.VAULT_SKIP_OPEN || ""))) {
    const browser = spawn("explorer.exe", [url], { detached: true, windowsHide: true, stdio: "ignore" });
    browser.on("error", () => console.log(`Open ${url} in your browser.`));
    browser.unref();
  }
}

async function main() {
  const action = String(process.argv[2] || "toggle").toLowerCase();
  if (!["toggle", "on", "off"].includes(action)) throw new Error("Use toggle, on, or off.");
  const currentState = await requestVault();
  if (action === "on" && currentState.ok) {
    console.log("Physical Music Vault is already ON.");
    return;
  }
  if (action === "off" && !currentState.ok) {
    console.log("Physical Music Vault is already OFF.");
    return;
  }
  if (currentState.ok) await stopVault(currentState);
  else await startVault();
}

main().catch(error => {
  console.error(`Physical Music Vault could not be toggled: ${error.message}`);
  process.exitCode = 1;
});
