// Sends real (trusted) mouse clicks and key presses to the Printify tab,
// because Printify's price box ignores values set by scripts.
const attached = new Set();
const navigationGenerations = new Map();
chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId));

const MAX_COORDINATE = 100000;
const MAX_TEXT_LENGTH = 10000;
const REQUEST_TYPES = new Set(["attach", "detach", "click", "type", "insert", "tab", "enter"]);
const CDP_METHODS = new Set(["Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText"]);

function isSupportedPrintifyUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "printify.com" && parsed.pathname.startsWith("/app/");
  } catch { return false; }
}

function isCoordinate(value) {
  return Number.isFinite(value) && value >= 0 && value <= MAX_COORDINATE;
}

function isText(value) {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

function validateRequest(msg) {
  if (!msg || typeof msg !== "object" || !REQUEST_TYPES.has(msg.cdp)) throw new Error("Unsupported debugger request.");
  if (msg.cdp === "click" && (!isCoordinate(msg.x) || !isCoordinate(msg.y))) throw new Error("Invalid click coordinates.");
  if ((msg.cdp === "type" || msg.cdp === "insert") && !isText(msg.text)) throw new Error("Invalid text input.");
}

function validateCdpCommand(method, params) {
  if (!CDP_METHODS.has(method) || !params || typeof params !== "object") throw new Error("Unsupported debugger command.");
  if (method === "Input.dispatchMouseEvent") {
    if (!new Set(["mouseMoved", "mousePressed", "mouseReleased"]).has(params.type) ||
      !isCoordinate(params.x) || !isCoordinate(params.y) ||
      (params.button !== undefined && params.button !== "left") ||
      (params.clickCount !== undefined && (!Number.isInteger(params.clickCount) || params.clickCount < 1 || params.clickCount > 3))) {
      throw new Error("Invalid mouse command.");
    }
    return;
  }
  if (method === "Input.insertText") {
    if (!isText(params.text)) throw new Error("Invalid text command.");
    return;
  }
  if (!new Set(["rawKeyDown", "keyDown", "keyUp"]).has(params.type) || typeof params.key !== "string" || params.key.length > 64 ||
    (params.code !== undefined && (typeof params.code !== "string" || params.code.length > 64)) ||
    (params.text !== undefined && !isText(params.text)) ||
    (params.unmodifiedText !== undefined && !isText(params.unmodifiedText)) ||
    (params.windowsVirtualKeyCode !== undefined && (!Number.isInteger(params.windowsVirtualKeyCode) || params.windowsVirtualKeyCode < 0 || params.windowsVirtualKeyCode > 255)) ||
    (params.modifiers !== undefined && (!Number.isInteger(params.modifiers) || params.modifiers < 0 || params.modifiers > 15)) ||
    (params.commands !== undefined && (!Array.isArray(params.commands) || params.commands.some((command) => typeof command !== "string" || command.length > 64)))) {
    throw new Error("Invalid keyboard command.");
  }
}

async function safeDetach(tabId) {
  try { await chrome.debugger.detach({ tabId }); } catch {}
  attached.delete(tabId);
}

async function getSupportedSenderTab(sender) {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) throw new Error("Debugger requests must come from this extension's Printify content script.");
  if (typeof sender.url === "string" && !isSupportedPrintifyUrl(sender.url)) throw new Error("Debugger requests must come from a supported Printify page.");
  const tabId = sender.tab.id;
  const generation = navigationGenerations.get(tabId) || 0;
  const tab = await chrome.tabs.get(tabId);
  if (generation !== (navigationGenerations.get(tabId) || 0) || !isSupportedPrintifyUrl(tab.url)) throw new Error("Debugger automation is only available on supported Printify pages.");
  return { tabId, generation };
}

async function isStillSupported(session) {
  if (session.generation !== (navigationGenerations.get(session.tabId) || 0)) return false;
  try {
    const tab = await chrome.tabs.get(session.tabId);
    return session.generation === (navigationGenerations.get(session.tabId) || 0) && isSupportedPrintifyUrl(tab.url);
  } catch { return false; }
}

async function send(session, method, params) {
  validateCdpCommand(method, params);
  try { return await chrome.debugger.sendCommand({ tabId: session.tabId }, method, params); }
  catch (e) {
    if (!/not attached|detached/i.test(e.message || "")) throw e;
    attached.delete(session.tabId);
    await ensure(session);
    return chrome.debugger.sendCommand({ tabId: session.tabId }, method, params);
  }
}

async function ensure(session) {
  const { tabId } = session;
  if (attached.has(tabId)) {
    if (!await isStillSupported(session)) {
      await safeDetach(tabId);
      throw new Error("Debugger automation is only available on supported Printify pages.");
    }
    return;
  }
  if (!await isStillSupported(session)) throw new Error("Debugger automation is only available on supported Printify pages.");
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    // The service worker restarted but the tab is still attached from before: keep using it
    if (!/already attached/i.test(e.message || "")) throw e;
  }
  if (!await isStillSupported(session)) {
    await safeDetach(tabId);
    throw new Error("Printify navigation changed before debugger attachment completed.");
  }
  attached.add(tabId);
}

async function key(session, k) {
  await send(session, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...k });
  const up = { ...k }; delete up.text; delete up.unmodifiedText; delete up.commands;
  await send(session, "Input.dispatchKeyEvent", { type: "keyUp", ...up });
}

function charKey(ch) {
  if (/\d/.test(ch)) return { key: ch, code: "Digit" + ch, windowsVirtualKeyCode: 48 + +ch, text: ch, unmodifiedText: ch };
  if (ch === ".") return { key: ".", code: "Period", windowsVirtualKeyCode: 190, text: ".", unmodifiedText: "." };
  return { key: ch, text: ch, unmodifiedText: ch };
}

async function handle(session, msg) {
  const { tabId } = session;
  if (msg.cdp === "detach") {
    await safeDetach(tabId);
    return;
  }
  await ensure(session);
  if (msg.cdp === "attach") return;
  if (msg.cdp === "click") {
    const { x, y } = msg;
    await send(session, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send(session, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send(session, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  if (msg.cdp === "type") {
    await key(session, { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] });
    await key(session, { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    for (const ch of String(msg.text)) await key(session, charKey(ch));
  }
  if (msg.cdp === "insert") {
    // Replace the box's text with any text (letters, ®, ™, spaces…)
    await key(session, { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] });
    await key(session, { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    if (msg.text) await send(session, "Input.insertText", { text: String(msg.text) });
  }
  if (msg.cdp === "tab") {
    await key(session, { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  }
  if (msg.cdp === "enter") {
    await key(session, { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg?.cdp) return;
  let trustedTabId = null;
  (async () => {
    validateRequest(msg);
    if (sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id)) trustedTabId = sender.tab.id;
    const session = await getSupportedSenderTab(sender);
    await handle(session, msg);
  })().then(() => reply({ ok: true })).catch(async (e) => {
    if (Number.isInteger(trustedTabId)) await safeDetach(trustedTabId);
    reply({ ok: false, error: e.message });
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  navigationGenerations.delete(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !isSupportedPrintifyUrl(changeInfo.url)) {
    navigationGenerations.set(tabId, (navigationGenerations.get(tabId) || 0) + 1);
    safeDetach(tabId);
  }
});

// Move saved data from sync storage (older versions) to local storage, which has room for many products
async function migrate() {
  const loc = await chrome.storage.local.get("profiles");
  if (loc.profiles) return;
  const syn = await chrome.storage.sync.get(["profiles", "activeId", "prices"]);
  if (syn.profiles || syn.prices) await chrome.storage.local.set(syn);
}
chrome.runtime.onInstalled.addListener(migrate);
chrome.runtime.onStartup.addListener(migrate);
