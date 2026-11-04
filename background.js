// Sends real (trusted) mouse clicks and key presses to the Printify tab,
// because Printify's price box ignores values set by scripts.
const attached = new Set();
chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId));

async function send(tabId, method, params) {
  try { return await chrome.debugger.sendCommand({ tabId }, method, params); }
  catch (e) {
    if (!/not attached|detached/i.test(e.message || "")) throw e;
    attached.delete(tabId);
    await ensure(tabId);
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }
}

async function ensure(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    // The service worker restarted but the tab is still attached from before: keep using it
    if (!/already attached/i.test(e.message || "")) throw e;
  }
  attached.add(tabId);
}

async function key(tabId, k) {
  await send(tabId, "Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...k });
  const up = { ...k }; delete up.text; delete up.unmodifiedText; delete up.commands;
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...up });
}

function charKey(ch) {
  if (/\d/.test(ch)) return { key: ch, code: "Digit" + ch, windowsVirtualKeyCode: 48 + +ch, text: ch, unmodifiedText: ch };
  if (ch === ".") return { key: ".", code: "Period", windowsVirtualKeyCode: 190, text: ".", unmodifiedText: "." };
  return { key: ch, text: ch, unmodifiedText: ch };
}

async function handle(tabId, msg) {
  if (msg.cdp === "detach") {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    attached.delete(tabId);
    return;
  }
  await ensure(tabId);
  if (msg.cdp === "attach") return;
  if (msg.cdp === "click") {
    const { x, y } = msg;
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  if (msg.cdp === "type") {
    await key(tabId, { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] });
    await key(tabId, { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    for (const ch of String(msg.text)) await key(tabId, charKey(ch));
  }
  if (msg.cdp === "insert") {
    // Replace the box's text with any text (letters, ®, ™, spaces…)
    await key(tabId, { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] });
    await key(tabId, { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    if (msg.text) await send(tabId, "Input.insertText", { text: String(msg.text) });
  }
  if (msg.cdp === "tab") {
    await key(tabId, { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  }
  if (msg.cdp === "enter") {
    await key(tabId, { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg?.cdp || !sender.tab) return;
  handle(sender.tab.id, msg).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: e.message }));
  return true;
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
