import { createProbe, createRefreshController } from "./engine.mjs?v=20261114-continuous";

const el = id => document.getElementById(id);
const entryOptions = new URLSearchParams(location.hash.slice(1));
const computerRun = entryOptions.get("computer");
const webDebuggerEntry = ["webdebugger-serial", "webdebugger-stop"].includes(computerRun);
const h5ManualEntry = entryOptions.get("h5") === "manual";
const phoneAutoEntry = entryOptions.get("h5") === "auto";
const phoneEntry = h5ManualEntry || phoneAutoEntry;
el("duration").value = phoneEntry ? "continuous" : "two-minutes";
el("duration").onchange = () => { el("start").textContent = el("duration").value === "continuous" ? "开始持续刷新" : "开始两分钟运行"; };
el("duration").onchange();
const computerKind = webDebuggerEntry ? computerRun.slice("webdebugger-".length) : computerRun;
let computerStarted = false;
const events = [];
const positionReceipts = [];
let requestSequence = 0;
const clockAnchor = { wall_ms: Date.now(), performance_ms: performance.now() };
let miniapp = false;
let configured = false;
let configurationFailed = false;
let bridgePageState;
let bridgeAvailable = false;
let phoneStarted = false;
let phoneUserStopped = false;
let publicAuthorizationExpires = 0;
let authorizationRequest = null;
const canStart = () => configured && (miniapp || webDebuggerEntry || (phoneEntry && bridgeAvailable));
function updateWebDebuggerSummary() {
  if (!webDebuggerEntry && !phoneEntry) return;
  el("computer").hidden = false;
  let start = -1;
  events.forEach((row, i) => { if (row.event === "start") start = i; });
  if (start < 0) {
    el("computer").textContent = "本轮尚未开始；授权与定位结果以实际调用记录为准。";
    return;
  }
  const session = events.slice(start);
  const requests = session.filter(row => row.event === "request").length;
  const successes = positionReceipts.filter(row => row.requested_ms >= session[0].ms).length;
  const stop = session.find(row => row.event === "stop");
  const states = session.filter(row => typeof row.running === "boolean");
  const state = states[states.length - 1];
  const reasons = { budget: "达到两分钟，已停止", user: "已手动停止",
    document_hidden: "网页隐藏，已停止", bridge_background: "收到后台状态，已停止" };
  const status = state.running ? "运行中" : reasons[stop?.reason] || "已停止，原因见下方记录";
  el("computer").textContent = `本轮 ${requests} 次请求，${successes} 次成功；${status}${state.pending ? "；等待返回" : ""}。`;
}
function createController(serial) {
  const build = serial ? createRefreshController : createProbe;
  const locate = (type, done) => {
    const requestId = ++requestSequence;
    const requestedMs = performance.now();
    wx.getLocation({
      type,
      success: result => {
        const receipt = {
          request_id: requestId,
          requested_type: type,
          requested_ms: requestedMs,
          received_ms: performance.now(),
          received_wall_ms: Date.now(),
          page_visible_at_receipt: document.visibilityState === "visible",
          result: { ...result },
        };
        positionReceipts.push(receipt);
        const label = type === "gcj02" ? "地图坐标（GCJ02）" : "原始坐标（WGS84）";
        el("position").textContent = `${label}：纬度 ${result.latitude}，经度 ${result.longitude}。这是本页最近一次收到的回调，接收时间为 ${new Date(receipt.received_wall_ms).toLocaleTimeString()}。`;
        done("success", result);
      },
      fail: result => done("fail", result), cancel: result => done("cancel", result),
    });
  };
  return build({
  now: () => performance.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: id => clearTimeout(id),
  request: serial ? locate : done => locate("gcj02", done),
  record: event => {
    events.push(event);
    if (phoneAutoEntry && event.event === "stop") {
      if (["document_hidden", "bridge_background", "pagehide", "reconfigure"].includes(event.reason)) phoneStarted = false;
      if (event.reason === "gcj_request_completed_after_stop") {
        phoneStarted = false;
        setTimeout(startPhoneRun, 0);
      }
    }
    el("mode").disabled = event.running || event.pending || event.restore_required === true;
    el("duration").disabled = event.running || event.pending || event.restore_required === true;
    el("events").textContent = events.slice(-12).map(row => JSON.stringify(row)).join("\n");
    const active = event.active === null ? "未知" : event.active ? "前台" : "后台";
    el("state").textContent = `网页${event.visible ? "可见" : "隐藏"}；${event.focused ? "有输入焦点" : "无输入焦点"}；页面状态提示：${active}。`;
    updateWebDebuggerSummary();
  },
  });
}
let probe = createController(true);
el("mode").onchange = () => {
  probe.stop("mode_change");
  probe = createController(el("mode").value === "serial");
  probe.visibility(document.visibilityState === "visible");
  probe.focus(document.hasFocus());
  probe.pageState(bridgePageState);
};

probe.visibility(document.visibilityState === "visible");
probe.focus(document.hasFocus());
document.addEventListener("visibilitychange", () => {
  probe.visibility(document.visibilityState === "visible");
  if (document.visibilityState === "visible" && phoneAutoEntry) activatePhonePage();
});
window.addEventListener("focus", () => probe.focus(true));
window.addEventListener("blur", () => probe.focus(false));
window.addEventListener("pagehide", () => probe.stop("pagehide"));

function bridgeReady() {
  bridgeAvailable = true;
  WeixinJSBridge.on("onPageStateChange", result => {
    bridgePageState = result.active; probe.pageState(result.active);
    if (result.active === true || result.active === "true") startPhoneRun();
  });
  wx.miniProgram.getEnv(result => {
    miniapp = result.miniprogram === true;
    events.push({ event: "environment", ms: performance.now(), miniapp });
    el("environment").textContent = miniapp ? "已确认在小程序内嵌网页中。" : phoneEntry ? "微信网页已连接。" : webDebuggerEntry ? "当前为公众号网页电脑对照入口；不是小程序定位采用验证。" : "当前不是小程序内嵌网页，请通过自有小程序打开。";
    el("start").disabled = !canStart();
    startComputerRun();
    startPhoneRun();
  });
}
if (window.wx) {
  el("configure").disabled = false;
  if (window.WeixinJSBridge) bridgeReady();
  else document.addEventListener("WeixinJSBridgeReady", bridgeReady, { once: true });
  wx.error(result => {
    configurationFailed = true;
    configured = false;
    el("start").disabled = true;
    el("configure").disabled = false;
    probe.stop("config_error");
    events.push({ event: "config_error", ms: performance.now(), errMsg: result.errMsg });
    el("permission").textContent = result.errMsg;
    if ((miniapp || webDebuggerEntry) && ["serial", "stop"].includes(computerKind)) setTimeout(sendComputerReport, 0);
  });
} else {
  el("permission").textContent = "微信 JS-SDK 未能加载。";
}

el("configure").onclick = () => {
  let config;
  try { config = JSON.parse(el("config").value); }
  catch { el("permission").textContent = "授权信息不是有效的 JSON。"; return; }
  configured = false;
  configurationFailed = false;
  el("configure").disabled = true;
  el("start").disabled = true;
  probe.stop("reconfigure");
  const { appId, timestamp, nonceStr, signature } = config;
  wx.config({ appId, timestamp, nonceStr, signature, debug: false, jsApiList: ["getLocation"] });
  wx.ready(() => {
    if (configurationFailed) {
      events.push({ event: "config_ready_ignored_after_error", ms: performance.now() });
      return;
    }
    configured = true;
    events.push({ event: "config_ready", ms: performance.now() });
    el("permission").textContent = "网页授权已就绪，可以开始。";
    el("start").disabled = !canStart();
    startComputerRun();
    startPhoneRun();
  });
};
const linkedConfig = entryOptions.get("wxconfig");
el("start").onclick = () => {
  phoneUserStopped = false;
  phoneStarted = true;
  probe.start({ continuous: el("duration").value === "continuous" });
};
el("stop").onclick = () => { phoneUserStopped = true; phoneStarted = false; probe.stop("user"); };

function startPhoneRun() {
  if (!phoneAutoEntry || phoneStarted || phoneUserStopped || !canStart()
      || document.visibilityState !== "visible" || bridgePageState === false || bridgePageState === "false") return;
  phoneStarted = true;
  probe.start({ continuous: true });
}

function activatePhonePage() {
  if (publicAuthorizationExpires * 1000 <= Date.now() + 120000) return refreshPhoneAuthorization();
  startPhoneRun();
}

function refreshPhoneAuthorization() {
  if (authorizationRequest) return authorizationRequest;
  el("permission").textContent = "正在自动更新网页授权…";
  authorizationRequest = (async () => {
    try {
      const response = await fetch(`./phone-auth.json?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("授权更新服务暂不可用，请稍后重新打开。");
      const authorization = await response.json();
      if (h5ManualEntry && linkedConfig !== null) {
        location.replace(authorization.entry_url);
        return;
      }
      const config = authorization.entries[location.href.split("#", 1)[0]];
      if (!config) { location.replace(authorization.entry_url); return; }
      if (authorization.expires_at * 1000 <= Date.now()) throw new Error("授权尚未续期，请稍后重新打开。");
      publicAuthorizationExpires = authorization.expires_at;
      el("config").value = JSON.stringify(config);
      el("configure").onclick();
    } catch (error) {
      configured = false;
      el("start").disabled = true;
      probe.stop("authorization_unavailable");
      el("permission").textContent = error.message;
    } finally { authorizationRequest = null; }
  })();
  return authorizationRequest;
}
function snapshot() {
  return {
    schema: "locationlab.webview-entry.v2",
    scope: "THIS_WEBVIEW_CALL_RESULTS_AND_LIFECYCLE_ONLY",
    clock_anchor: clockAnchor,
    captured_at: { wall_ms: Date.now(), performance_ms: performance.now() },
    miniapp_environment: miniapp,
    entry_mode: phoneAutoEntry ? "EXPLICIT_WECHAT_H5_AUTO" : h5ManualEntry ? "EXPLICIT_WECHAT_H5_MANUAL" : webDebuggerEntry ? "EXPLICIT_WEB_DEBUGGER_DIAGNOSTIC" : "MINIAPP_ENTRY",
    jssdk_config_ready: configured,
    selected_mode: el("mode").value,
    selected_duration: el("duration").value,
    map_foreground: "NOT_OBSERVED",
    position_freshness: "NOT_ASSESSED",
    location_adoption: "NOT_ASSESSED",
    compatibility_fix_verified: false,
    receipt_semantics: "RAW_SUCCESS_CALLBACKS_INCLUDING_LATE_OR_DUPLICATE; RECEIPT_TIME_IS_NOT_SAMPLE_TIME",
    position_receipts: positionReceipts,
    events,
  };
}
el("export").onclick = () => {
  el("report").value = JSON.stringify(snapshot(), null, 2);
  updateWebDebuggerSummary();
};

function startComputerRun() {
  if (phoneEntry || !["serial", "stop"].includes(computerKind) || computerStarted || !canStart()) return;
  computerStarted = true;
  el("computer").hidden = false;
  el("computer").textContent = webDebuggerEntry ? "本次只在公众号网页调试器运行，记录留在当前页面。" : "本次为电脑自动运行，结束后向自有小程序交回定位回调和请求记录。";
  events.push({ event: "computer_run", ms: performance.now(), kind: computerRun });
  el("start").click();
  if (computerKind === "stop") setTimeout(() => el("stop").click(), 25000);
  setTimeout(sendComputerReport, computerKind === "stop" ? 40000 : 135000);
}
function sendComputerReport() {
  const report = snapshot();
  el("report").value = JSON.stringify(report, null, 2);
  if (miniapp) wx.miniProgram.postMessage({ data: report });
  el("computer").hidden = false;
  if (miniapp) el("computer").textContent = "电脑观察记录已交回自有小程序；定位样本新鲜度和微信地图采用仍需独立验证。";
  else updateWebDebuggerSummary();
}
if (phoneAutoEntry || (h5ManualEntry && linkedConfig !== null)) {
  refreshPhoneAuthorization();
} else if (linkedConfig !== null) {
  el("config").value = linkedConfig;
  el("configure").click();
}
