(() => {
  // Bump API_VERSION only when this public method contract changes. Bump
  // COMPONENT_REVISION for every clico.js or clico.css change so older open
  // Printify tabs can be identified and reloaded instead of partially swapped.
  const API_VERSION = 3;
  const COMPONENT_REVISION = 12;
  const SUCCESS_HOLD = 4500;
  const ERROR_HOLD = 4000;
  const CANCELLED_HOLD = 3000;
  if (globalThis.ClickAwayClico?.version === API_VERSION && globalThis.ClickAwayClico?.revision === COMPONENT_REVISION) return;

  const stateTimers = new WeakMap();
  const nextSuccessVariant = new WeakMap();
  const nextCancelledVariant = new WeakMap();
  const nextWorkingVariant = new WeakMap();
  const idleSchedules = new WeakMap();
  const nextIdleVariant = new WeakMap();
  const SUCCESS_VARIANTS = ["happy-celebration", "cool-victory", "shy-happiness", "proud-clico", "big-excitement"];
  const CANCELLED_VARIANTS = ["tiny-sigh", "oops", "sleepy-stop"];
  const WORKING_VARIANTS = ["deep-focus", "glasses-adjust", "checking-details"];
  const IDLE_VARIANTS = ["curious-look", "look-around", "sleepy-clico", "cheeky-smile", "glasses-fix", "thinking", "tiny-surprise", "proud-pose", "playful-wink"];
  const IDLE_DELAYS = [6000, 5000, 7000, 6000];
  let instanceNumber = 0;

  function markup(markerClass) {
    const id = `pfsp-clico-${++instanceNumber}`;
    return `<span class="pf-sp-clico ${markerClass}" aria-hidden="true"><svg viewBox="0 0 56 64" focusable="false">
      <defs>
        <radialGradient id="${id}-body" cx="32%" cy="24%" r="78%"><stop offset="0" stop-color="#f5ffc4"/><stop offset=".42" stop-color="#ddf77d"/><stop offset=".76" stop-color="#bbdf55"/><stop offset="1" stop-color="#91b938"/></radialGradient>
        <linearGradient id="${id}-shade" x1=".18" y1=".12" x2=".78" y2=".92"><stop offset=".5" stop-color="#83a934" stop-opacity="0"/><stop offset="1" stop-color="#5f8129" stop-opacity=".52"/></linearGradient>
        <linearGradient id="${id}-outer" x1=".2" y1="0" x2=".8" y2="1"><stop stop-color="#ff4f8b"/><stop offset=".22" stop-color="#ff6a55"/><stop offset=".58" stop-color="#ff8b24"/><stop offset="1" stop-color="#e94b25"/></linearGradient>
        <linearGradient id="${id}-middle" x1=".35" y1="0" x2=".65" y2="1"><stop stop-color="#fff06a"/><stop offset=".48" stop-color="#ffc52f"/><stop offset="1" stop-color="#ff7a22"/></linearGradient>
        <linearGradient id="${id}-lens" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b9f6ff" stop-opacity=".34"/><stop offset=".48" stop-color="#67dff5" stop-opacity=".14"/><stop offset="1" stop-color="#3777c8" stop-opacity=".2"/></linearGradient>
      </defs>
      <g class="pf-sp-clico-character">
        <g class="pf-sp-clico-hair">
          <path class="pf-sp-clico-flame-outer" d="M7 30.2c-1.2-6.1 2.5-11.7 9.2-16.5-1.7 6.1 2.2 9 5.8 4.1 3.4-4.6 2.5-10.5 8.5-17.1-1 8.7 3.3 14.4 7.4 9.3 2.9-3.7 2.7-7.7 9.2-9.7-3.2 8.4 3.9 11.1 2.1 19.2-.8 3.9-3.7 8.2-7.3 11.5Z" fill="url(#${id}-outer)" stroke="#762949" stroke-width="1.45" stroke-linejoin="round"/>
          <path class="pf-sp-clico-flame-accent" d="M11.8 29.4c-.6-4.7 2.2-8.6 7-12.1-1 4.8 2.4 6.5 5 2.4 2.7-4.2 2.3-8.5 5.9-12.9-.4 6.9 3.4 10.5 6.4 6.2 2.2-3.2 3.3-5.2 6.7-6.5-1.8 6.2 2.5 8.6.8 14.2-.7 2.7-2.7 5.9-5.3 8.8Z" fill="#ff7548" opacity=".9"/>
          <path class="pf-sp-clico-flame-middle" d="M17.2 29.6c-.7-3.7 1.4-7 5-9.8-.4 3.8 2.5 5 4.4 1.5 2-3.6 2.1-6.8 4.2-9.7.2 5.2 3.2 7.8 5.4 4.5 2.6 4.5 1.9 9.2-1 13.6Z" fill="url(#${id}-middle)"/>
          <path class="pf-sp-clico-flame-inner" d="M23.3 29.8c-.4-2.8 1.2-5.2 3.6-7.2 0 2.8 2.2 3.5 3.4.4 1-2.6 1.3-4.7 2.8-6.6 2.5 4.4 1.8 9-1.1 13.5Z" fill="#fff68a"/>
        </g>
        <path class="pf-sp-clico-body" d="M27.8 18.8c11.7-.6 20.7 7.2 21.4 18.2.8 11.2-7.6 20.1-20.1 20.9-12.6.8-21.8-7-22-18.1-.2-10.7 7.5-19 18.4-20.6.8-.2 1.5-.3 2.3-.4Z" fill="url(#${id}-body)" stroke="#173020" stroke-width="1.7" stroke-linejoin="round"/>
        <path class="pf-sp-clico-shade" d="M46.7 29.2c2.8 8.4-.2 17.4-7.7 22.4-5.3 3.5-12.3 4.7-18.2 2.5 7.1 4.5 17.2 2.4 23-4 5.3-5.8 7-13.8 2.9-20.9Z" fill="url(#${id}-shade)"/>
        <path class="pf-sp-clico-highlight" d="M10.5 34.2c1.5-6.5 6.5-10.7 12.8-12-4.8 2.5-8 6.3-9.1 11.1-.5 2.4-4.2 3.3-3.7.9Z" fill="#f7ffd1" opacity=".48"/>
        <ellipse class="pf-sp-clico-cheek" cx="13.5" cy="47.9" rx="3.4" ry="2"/><ellipse class="pf-sp-clico-cheek" cx="42.2" cy="47.4" rx="3.4" ry="2"/>
        <g class="pf-sp-clico-arm pf-sp-clico-arm-left"><path d="M7.7 41.9C3.5 43.4 2.8 47.5 5.8 49.8"/><circle cx="6.2" cy="50" r="3.1"/></g>
        <g class="pf-sp-clico-arm pf-sp-clico-arm-right"><path d="M48.1 41.5c4.2 1.4 5 5.5 2 7.8"/><circle cx="49.8" cy="49.6" r="3.1"/></g>
        <g class="pf-sp-clico-face">
          <g class="pf-sp-clico-eyes"><ellipse cx="19.7" cy="39.1" rx="5.7" ry="5.9"/><ellipse cx="36.2" cy="39.1" rx="5.7" ry="5.9"/><g class="pf-sp-clico-pupils"><ellipse cx="20.3" cy="39.7" rx="2.2" ry="2.9"/><ellipse cx="36.8" cy="39.7" rx="2.2" ry="2.9"/><circle cx="19.6" cy="38.5" r=".72"/><circle cx="36.1" cy="38.5" r=".72"/></g><g class="pf-sp-clico-happy-eyes"><path d="M17.2 40.4c1.5-2 3.4-2 4.9 0"/><path d="M33.8 40.4c1.5-2 3.4-2 4.9 0"/></g></g>
          <g class="pf-sp-clico-sleepy-lids"><path d="M14.7 38c2.9-2 6.6-2 9.3.2"/><path d="M31.3 38c2.9-2 6.6-2 9.3.2"/></g>
          <g class="pf-sp-clico-glasses"><rect class="pf-sp-clico-lens" x="11.4" y="32.1" width="15.7" height="14.2" rx="4.8" fill="url(#${id}-lens)"/><rect class="pf-sp-clico-lens" x="28.8" y="32.1" width="15.7" height="14.2" rx="4.8" fill="url(#${id}-lens)"/><path class="pf-sp-clico-bridge" d="M27 37.7c.6-.8 1.2-.8 1.8 0M11.5 36.7 8.2 35M44.4 36.7l3.3-1.7"/><path class="pf-sp-clico-lens-glint" d="m14 35 4.1-.7M31.4 35l4.2-.7"/></g>
          <path class="pf-sp-clico-brow pf-sp-clico-brow-left" d="m16.2 31 6-.6"/><path class="pf-sp-clico-brow pf-sp-clico-brow-right" d="m33.6 30.4 6 .6"/>
          <path class="pf-sp-clico-nose" d="m28 42.1-1.4 2.3 2.5.1"/>
          <path class="pf-sp-clico-mouth pf-sp-clico-mouth-idle" d="M22.8 49.8c2.8 2.1 6.4 1.6 9.5-.9"/><path class="pf-sp-clico-mouth pf-sp-clico-mouth-focus" d="M24 50.4c2.6-1.4 5.2-1.4 7.8 0"/><path class="pf-sp-clico-mouth pf-sp-clico-mouth-smile" d="M22.8 48.6c2.6 4.2 7.1 4.2 9.7-.2"/><path class="pf-sp-clico-mouth pf-sp-clico-mouth-open-grin" d="M20.5 48.2c3.5 6.2 11.7 6.5 15-.2-3.8 2.1-10.8 2.1-15 .2Z"/><path class="pf-sp-clico-mouth-grin-highlight" d="M24.3 50.1c2.2.9 4.8.9 7-.1"/><path class="pf-sp-clico-mouth pf-sp-clico-mouth-grin" d="M20.8 48c3.9 6 10.8 6.1 14.4-.3"/><path class="pf-sp-clico-mouth pf-sp-clico-mouth-frown" d="M23.1 53c2.5-2.4 6.1-2.5 9.4-.2"/><ellipse class="pf-sp-clico-mouth-o" cx="28" cy="49.8" rx="2.25" ry="2.8"/>
          <path class="pf-sp-clico-crack" d="m39.6 33.5-3.8 3.4 2.6 2-3.5 4.1 1.4 2.3"/>
          <path class="pf-sp-clico-repair-glint" d="m42 32.2.7 1.5 1.6.6-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.6Z"/>
        </g>
        <g class="pf-sp-clico-sparkles"><path d="m5.8 24.2 1.3 2.7 2.8 1.1-2.8 1.1-1.3 2.8-1.2-2.8L1.8 28l2.8-1.1Z"/><path d="m49.6 20.8 1 2.1 2.2.9-2.2.9-1 2.2-1-2.2-2.2-.9 2.2-.9Z"/><path d="m50.2 38 .8 1.6 1.6.7-1.6.7-.8 1.7-.7-1.7-1.7-.7 1.7-.7Z"/></g>
      </g></svg></span>`;
  }

  function setState(button, state, duration = 0) {
    if (!button?.querySelector(".pf-sp-clico") || (button.dataset.clicoTransient === "true" && !duration && ["idle", "hover"].includes(state))) return;
    if (state !== "idle") stopIdleSchedule(button);
    if (state !== "success") delete button.dataset.clicoSuccessVariant;
    if (state !== "cancelled") delete button.dataset.clicoCancelledVariant;
    if (state !== "working") delete button.dataset.clicoWorkingVariant;
    if (state !== "idle") delete button.dataset.clicoIdleVariant;
    if (state === "working" && button.dataset.clicoState !== "working") {
      const index = nextWorkingVariant.get(button) || 0;
      button.dataset.clicoWorkingVariant = WORKING_VARIANTS[index];
      nextWorkingVariant.set(button, (index + 1) % WORKING_VARIANTS.length);
    }
    const previous = stateTimers.get(button);
    if (previous) clearTimeout(previous);
    stateTimers.delete(button);
    button.dataset.clicoState = state;
    if (!duration) {
      delete button.dataset.clicoTransient;
      if (state === "idle") startIdleSchedule(button);
      return;
    }
    button.dataset.clicoTransient = "true";
    const timer = setTimeout(() => {
      if (stateTimers.get(button) !== timer) return;
      stateTimers.delete(button);
      if (!button.isConnected) return;
      delete button.dataset.clicoTransient;
      if (state === "success") delete button.dataset.clicoSuccessVariant;
      if (state === "cancelled") delete button.dataset.clicoCancelledVariant;
      button.dataset.clicoState = button.matches(":hover") ? "hover" : "idle";
      if (button.dataset.clicoState === "idle") startIdleSchedule(button);
    }, duration);
    stateTimers.set(button, timer);
  }

  function success(button) {
    if (!button?.querySelector(".pf-sp-clico")) return;
    const index = nextSuccessVariant.get(button) || 0;
    const variant = SUCCESS_VARIANTS[index];
    nextSuccessVariant.set(button, (index + 1) % SUCCESS_VARIANTS.length);
    button.dataset.clicoSuccessVariant = variant;
    setState(button, "success", SUCCESS_HOLD);
  }
  function outcome(button, ok) { if (ok) success(button); else setState(button, "error", ERROR_HOLD); }
  function failure(button, error) {
    const cancelled = /^Stopped\b/.test(error?.message || "");
    if (cancelled && button?.querySelector(".pf-sp-clico")) {
      const index = nextCancelledVariant.get(button) || 0;
      button.dataset.clicoCancelledVariant = CANCELLED_VARIANTS[index];
      nextCancelledVariant.set(button, (index + 1) % CANCELLED_VARIANTS.length);
    }
    setState(button, cancelled ? "cancelled" : "error", cancelled ? CANCELLED_HOLD : ERROR_HOLD);
  }
  function reducedMotion() { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; }
  function stopIdleSchedule(button) {
    const schedule = idleSchedules.get(button);
    if (schedule) clearTimeout(schedule.timer);
    idleSchedules.delete(button);
    if (button) delete button.dataset.clicoIdleVariant;
  }
  function startIdleSchedule(button) {
    if (!button?.isConnected || button.dataset.clicoState !== "idle" || reducedMotion() || idleSchedules.has(button)) return;
    button.dataset.clicoIdleVariant = "classic-idle";
    const schedule = { timer: 0, cadence: 1, nextAt: Date.now() + IDLE_DELAYS[0] };
    const active = () => {
      // An obsolete callback must not cancel a newer schedule for this button.
      if (idleSchedules.get(button) !== schedule) return false;
      if (!button.isConnected || button.dataset.clicoState !== "idle" || reducedMotion()) {
        stopIdleSchedule(button);
        return false;
      }
      return true;
    };
    const react = () => {
      if (!active()) return;
      const index = nextIdleVariant.get(button) || 0;
      button.dataset.clicoIdleVariant = IDLE_VARIANTS[index];
      nextIdleVariant.set(button, (index + 1) % IDLE_VARIANTS.length);
      // Start-to-start deadlines include the reaction's 1600ms hold.
      // A throttled tab resumes from this actual start, without catch-up bursts.
      schedule.nextAt = Date.now() + IDLE_DELAYS[schedule.cadence];
      schedule.cadence = (schedule.cadence + 1) % IDLE_DELAYS.length;
      schedule.timer = setTimeout(() => {
        if (!active()) return;
        button.dataset.clicoIdleVariant = "classic-idle";
        schedule.timer = setTimeout(react, Math.max(0, schedule.nextAt - Date.now()));
      }, 1600);
    };
    schedule.timer = setTimeout(react, Math.max(0, schedule.nextAt - Date.now()));
    idleSchedules.set(button, schedule);
  }
  function cleanup(button) {
    const timer = stateTimers.get(button);
    if (timer) clearTimeout(timer);
    stateTimers.delete(button);
    nextSuccessVariant.delete(button);
    nextCancelledVariant.delete(button);
    nextWorkingVariant.delete(button);
    nextIdleVariant.delete(button);
    stopIdleSchedule(button);
    if (button) { delete button.dataset.clicoTransient; delete button.dataset.clicoState; delete button.dataset.clicoSuccessVariant; delete button.dataset.clicoWorkingVariant; delete button.dataset.clicoIdleVariant; }
  }

  globalThis.ClickAwayClico = Object.freeze({ version: API_VERSION, revision: COMPONENT_REVISION, markup, setState, success, outcome, failure, cleanup });
})();
