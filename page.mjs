import { createProbe, createRefreshController } from "./engine.mjs";

const el = id => document.getElementById(id);
const events = [];
const clockAnchor = { wall_ms: Date.now(), performance_ms: performance.now() };
let miniapp = false;
let configured = false;
let bridgePageState;
function createController(serial) {
  const build = serial ? createRefreshController : createProbe;
  const locate = (type, done) => wx.getLocation({
    type, success: result => done("success", result),
    fail: result => done("fail", result), cancel: result => done("cancel", result),
  });
  return build({
  now: () => performance.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: id => clearTimeout(id),
  request: serial ? locate : done => locate("gcj02", done),
  record: event => {
    events.push(event);
    el("mode").disabled = event.running || event.pending || event.restore_required === true;
    el("events").textContent = events.slice(-12).map(row => JSON.stringify(row)).join("\n");
    const active = event.active === null ? "未知" : event.active ? "前台" : "后台";
    el("state").textContent = `网页${event.visible ? "可见" : "隐藏"}；${event.focused ? "有输入焦点" : "无输入焦点"}；页面状态提示：${active}。`;
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
document.addEventListener("visibilitychange", () => probe.visibility(document.visibilityState === "visible"));
window.addEventListener("focus", () => probe.focus(true));
window.addEventListener("blur", () => probe.focus(false));
window.addEventListener("pagehide", () => probe.stop("pagehide"));

function bridgeReady() {
  WeixinJSBridge.on("onPageStateChange", result => { bridgePageState = result.active; probe.pageState(result.active); });
  wx.miniProgram.getEnv(result => {
    miniapp = result.miniprogram === true;
    events.push({ event: "environment", ms: performance.now(), miniapp });
    el("environment").textContent = miniapp ? "已确认在小程序内嵌网页中。" : "当前不是小程序内嵌网页，请通过自有小程序打开。";
    el("start").disabled = !(miniapp && configured);
  });
}
if (window.wx) {
  el("configure").disabled = false;
  if (window.WeixinJSBridge) bridgeReady();
  else document.addEventListener("WeixinJSBridgeReady", bridgeReady, { once: true });
  wx.error(result => {
    configured = false;
    el("start").disabled = true;
    el("configure").disabled = false;
    probe.stop("config_error");
    events.push({ event: "config_error", ms: performance.now(), errMsg: result.errMsg });
    el("permission").textContent = result.errMsg;
  });
} else {
  el("permission").textContent = "微信 JS-SDK 未能加载。";
}

el("configure").onclick = () => {
  let config;
  try { config = JSON.parse(el("config").value); }
  catch { el("permission").textContent = "授权信息不是有效的 JSON。"; return; }
  configured = false;
  el("configure").disabled = true;
  el("start").disabled = true;
  probe.stop("reconfigure");
  const { appId, timestamp, nonceStr, signature } = config;
  wx.config({ appId, timestamp, nonceStr, signature, debug: false, jsApiList: ["getLocation"] });
  wx.ready(() => {
    configured = true;
    events.push({ event: "config_ready", ms: performance.now() });
    el("permission").textContent = "JS-SDK 配置验证已返回就绪；定位权限以实际调用结果为准。";
    el("start").disabled = !miniapp;
  });
};
el("start").onclick = () => probe.start();
el("stop").onclick = () => probe.stop("user");
el("export").onclick = () => {
  el("report").value = JSON.stringify({
    schema: "locationlab.webview-entry.v1",
    scope: "THIS_WEBPAGE_ENTRY_AND_LIFECYCLE_ONLY",
    clock_anchor: clockAnchor,
    miniapp_environment: miniapp,
    jssdk_config_ready: configured,
    selected_mode: el("mode").value,
    map_foreground: "NOT_OBSERVED",
    position_freshness: "NOT_ASSESSED",
    location_adoption: "NOT_ASSESSED",
    compatibility_fix_verified: false,
    events,
  }, null, 2);
};
