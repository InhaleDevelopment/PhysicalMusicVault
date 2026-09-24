const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { atomicWriteJson } = require("./vault-platform");

const root = __dirname;
const serverPath = path.join(root, "vault-server.js");
const logsDir = path.join(root, "logs");
const statusPath = path.join(root, "agent-status.json");
const stopRequestPath = path.join(root, "vault-stop.request");
const port = Number(process.env.VAULT_PORT || 8787);
const restartDelayMs = Number(process.env.AGENT_RESTART_DELAY_MS || 5000);
const healthIntervalMs = Number(process.env.AGENT_HEALTH_INTERVAL_MS || 30000);

fs.mkdirSync(logsDir, { recursive: true });

const agentLogPath = path.join(logsDir, "vault-agent.log");
const serverLogPath = path.join(logsDir, "vault-server.log");
const serverErrorLogPath = path.join(logsDir, "vault-server-error.log");

let serverProcess = null;
let shuttingDown = false;
let healthFailures = 0;

const status = {
  ok: false,
  agentPid: process.pid,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  port,
  serverPid: null,
  serverRunning: false,
  serverStartedAt: null,
  lastServerExit: null,
  restartCount: 0,
  lastError: "",
  lastHealthCheck: null,
  lastHealthStatus: "",
  url: `http://localhost:${port}/`,
  logs: {
    agent: agentLogPath,
    server: serverLogPath,
    serverError: serverErrorLogPath
  }
};

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(agentLogPath, `${line}\n`, "utf8");
  console.log(line);
}

function writeStatus() {
  status.updatedAt = new Date().toISOString();
  atomicWriteJson(statusPath, status);
}

function scheduleServerStart(reason) {
  if (shuttingDown) return;
  status.restartCount += 1;
  appendLog(`${reason} Starting vault server in ${Math.round(restartDelayMs / 1000)} seconds.`);
  writeStatus();
  setTimeout(() => {
    try {
      startServer();
    } catch (error) {
      status.lastError = error.message;
      appendLog(`Start failed: ${error.message}`);
      writeStatus();
      scheduleServerStart("Retry scheduled.");
    }
  }, restartDelayMs);
}

async function checkDashboard() {
  status.lastHealthCheck = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`http://localhost:${port}/api/vault`, {
      cache: "no-store",
      signal: controller.signal
    });
    status.ok = response.ok;
    status.lastHealthStatus = response.ok ? `Dashboard API HTTP ${response.status}` : `Dashboard API HTTP ${response.status}`;
    healthFailures = response.ok ? 0 : healthFailures + 1;
  } catch (error) {
    healthFailures += 1;
    status.ok = false;
    status.lastHealthStatus = error.name === "AbortError" ? "Dashboard API timed out" : error.message || "Dashboard API unavailable";
  } finally {
    clearTimeout(timer);
  }

  if (healthFailures >= 3 && serverProcess && !serverProcess.killed) {
    appendLog(`Dashboard health failed ${healthFailures} times. Restarting server.`);
    serverProcess.kill();
  }
  writeStatus();
}

function startServer() {
  status.serverStartedAt = new Date().toISOString();
  status.lastError = "";
  status.serverRunning = true;
  writeStatus();

  appendLog("Starting vault server.");
  const out = fs.createWriteStream(serverLogPath, { flags: "a" });
  const err = fs.createWriteStream(serverErrorLogPath, { flags: "a" });
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, VAULT_PORT: String(port) },
    windowsHide: true
  });
  status.serverPid = serverProcess.pid;
  status.serverRunning = true;
  writeStatus();

  serverProcess.stdout.pipe(out);
  serverProcess.stderr.pipe(err);

  serverProcess.on("exit", (code, signal) => {
    status.serverRunning = false;
    status.serverPid = null;
    status.lastServerExit = new Date().toISOString();
    status.lastError = `Vault server exited with code ${code ?? ""} ${signal ?? ""}`.trim();
    appendLog(status.lastError);
    writeStatus();

    if (!shuttingDown) {
      scheduleServerStart("Server exited.");
    }
  });
}

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  status.ok = false;
  status.serverRunning = false;
  status.lastError = "Vault Agent stopped.";
  writeStatus();
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  appendLog("Vault Agent stopped.");
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

try {
  try { fs.unlinkSync(stopRequestPath); } catch {}
  appendLog("Vault Agent starting.");
  startServer();
  setInterval(() => {
    if (!fs.existsSync(stopRequestPath)) return;
    try { fs.unlinkSync(stopRequestPath); } catch {}
    stop();
    setTimeout(() => process.exit(0), 250);
  }, 500);
  setInterval(() => {
    checkDashboard().catch(error => {
      status.lastError = error.message;
      writeStatus();
    });
  }, healthIntervalMs);
  setTimeout(() => checkDashboard().catch(() => {}), 3000);
} catch (error) {
  status.ok = false;
  status.lastError = error.message;
  appendLog(`Vault Agent failed: ${error.message}`);
  writeStatus();
  scheduleServerStart("Initial start failed.");
}
