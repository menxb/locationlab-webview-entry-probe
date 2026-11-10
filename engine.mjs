export function pageActive(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

export function createProbe({ request, record, now, schedule, cancel }) {
  let running = false;
  let pending = false;
  let generation = 0;
  let visible = true;
  let focused = null;
  let active = null;
  let nextTimer;
  let budgetTimer;
  let end = 0;
  let requestId = 0;

  function log(event, detail = {}) {
    record({ event, ms: now(), running, pending, visible, focused, active, ...detail });
  }

  function stop(reason) {
    running = false;
    generation += 1;
    cancel(nextTimer);
    cancel(budgetTimer);
    log("stop", { reason });
  }

  function send() {
    if (!running) return;
    if (now() >= end) return stop("budget");
    if (!visible || active === false) return stop("page_hidden");
    pending = true;
    const id = ++requestId;
    const owner = generation;
    const begin = now();
    log("request", { id, requested_type: "gcj02" });
    request((status, result) => {
      pending = false;
      const late = owner !== generation;
      log("callback", {
        id, status, late, delay_ms: now() - begin,
        errMsg: result.errMsg ?? null,
        cached: result.cached ?? null,
      });
      if (running && !late) nextTimer = schedule(send, 10000);
    });
  }

  return {
    start() {
      if (running || pending || !visible || active === false) {
        log("start_blocked");
        return;
      }
      running = true;
      generation += 1;
      end = now() + 120000;
      log("start", { duration_ms: 120000, interval_after_callback_ms: 10000 });
      budgetTimer = schedule(() => stop("budget"), 120000);
      send();
    },
    stop,
    visibility(value) {
      visible = value;
      log("visibility");
      if (!visible && running) stop("document_hidden");
    },
    focus(value) {
      focused = value;
      log("focus");
    },
    pageState(value) {
      active = pageActive(value);
      log("page_state", { raw_active: value ?? null, raw_type: typeof value });
      if (active === false && running) stop("bridge_background");
    },
  };
}

// Public JS-SDK requests only. A completed pair is not evidence of a fresh sample.
export function createRefreshController({ request, record, now, schedule, cancel }) {
  let running = false;
  let pending = null;
  let visible = true;
  let active = null;
  let focused = null;
  let generation = 0;
  let requestId = 0;
  let end = 0;
  let nextTimer;
  let budgetTimer;
  let restoreRequired = false;

  const available = () => visible && active !== false;
  function log(event, detail = {}) {
    record({ event, ms: now(), running, pending: pending !== null,
      visible, focused, active, restore_required: restoreRequired, ...detail });
  }
  function stop(reason) {
    running = false;
    generation += 1;
    cancel(nextTimer);
    cancel(budgetTimer);
    log("stop", { reason });
  }
  function send(type, purpose) {
    if (pending || !available()) return;
    if (purpose === "cycle" && (!running || now() >= end)) return stop("budget");
    const token = { id: ++requestId, generation, type, purpose, began: now() };
    pending = token;
    if (type === "wgs84") restoreRequired = true;
    log("request", { id: token.id, requested_type: type, purpose });
    request(type, (status, result = {}) => {
      if (pending !== token) return log("duplicate_callback", { id: token.id });
      pending = null;
      const late = token.generation !== generation;
      const usable = status === "success" && result.cached !== true;
      log("callback", { id: token.id, requested_type: type, purpose,
        status, late, delay_ms: now() - token.began,
        cached: result.cached ?? null, errMsg: result.errMsg ?? null });

      if (type === "wgs84") {
        if (!usable && running) stop(status === "success" ? "wgs_cached" : "wgs_failed");
        if (running && now() >= end) stop("budget");
        // Queue on a later task: the original successful callback must finish first.
        // One GCJ02 cleanup attempt is allowed after failure/stop, while visible.
        if (available()) nextTimer = schedule(() => {
          if (available() && !pending) send("gcj02", running && !late && usable ? "cycle" : "restore");
        }, 0);
        return;
      }

      if (!usable) {
        restoreRequired = true;
        return stop(status === "success" ? "gcj_cached_restore_unverified" : "gcj_failed_restore_unverified");
      }
      restoreRequired = false;
      if (running && now() >= end) stop("budget");
      if (purpose === "restore" || late || !running) return stop("gcj_request_completed_after_stop");
      log("pair_completed", { sample_freshness: "NOT_ASSESSED", map_adoption: "NOT_ASSESSED" });
      nextTimer = schedule(() => send("wgs84", "cycle"), 10000);
    });
  }

  return {
    start() {
      if (running || pending || !available()) return log("start_blocked");
      if (restoreRequired) {
        log("restore_before_new_cycle");
        send("gcj02", "restore");
        return;
      }
      running = true;
      generation += 1;
      end = now() + 120000;
      log("start", { duration_ms: 120000, sequence: ["wgs84", "gcj02"], interval_after_pair_ms: 10000 });
      budgetTimer = schedule(() => stop("budget"), 120000);
      send("wgs84", "cycle");
    },
    stop,
    visibility(value) {
      visible = value;
      log("visibility");
      if (!visible) stop("document_hidden");
    },
    focus(value) { focused = value; log("focus"); },
    pageState(value) {
      active = pageActive(value);
      log("page_state", { raw_active: value ?? null, raw_type: typeof value });
      if (active === false) stop("bridge_background");
    },
  };
}
