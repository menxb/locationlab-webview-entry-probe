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
