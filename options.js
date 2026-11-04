const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
let incoming = null, incomingNames = [];
const LOCAL_DATA_KEYS = ["profiles", "activeId", "prices", "varNames", "pinned", "fabPositions"];
const LEGACY_SYNC_KEYS = ["profiles", "activeId", "prices"];
const cleanNames = (a) => Array.isArray(a) ? a.filter((r) => r && typeof r.from === "string" && typeof r.to === "string" && r.from.trim() && r.to.trim())
  .map((r) => ({ from: r.from.trim(), to: r.to.trim() })) : [];

function setStatus(t, cls = "") { $("status").textContent = t; $("status").className = cls; }
function setDeleteStatus(t, cls = "") { $("deleteStatus").textContent = t; $("deleteStatus").className = cls; }

async function current() {
  const d = await chrome.storage.local.get(["profiles", "activeId", "varNames"]);
  return { profiles: d.profiles || [], activeId: d.activeId || null, varNames: d.varNames || [] };
}

async function showSummary() {
  const { profiles } = await current();
  $("summary").textContent = profiles.length
    ? `${profiles.length} product${profiles.length === 1 ? "" : "s"}: ${profiles.map((p) => p.name).join(", ")}.`
    : "No products saved yet.";
  $("export").disabled = !profiles.length && !(await current()).varNames.length;
}

$("export").addEventListener("click", async () => {
  const { profiles, activeId, varNames } = await current();
  const data = { app: "printify-size-pricer", version: 1, exportedAt: new Date().toISOString(), activeId, profiles, varNames };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `clickaway-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

function clean(p) {
  if (!p || typeof p.name !== "string" || !p.name.trim()) return null;
  const sizes = Array.isArray(p.sizes) ? p.sizes.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  const prices = {};
  for (const [k, v] of Object.entries(p.prices || {})) {
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) prices[k] = n.toFixed(2);
  }
  const links = Array.isArray(p.links) ? p.links.filter((x) => typeof x === "string" && x.trim()) : [];
  const colors = Array.isArray(p.colors) ? p.colors.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  const held = Array.isArray(p.held) ? p.held.filter((x) => typeof x === "string") : [];
  const variantLabel = typeof p.variantLabel === "string" ? p.variantLabel.trim().slice(0, 20) : "";
  const varNames = cleanNames(p.varNames);
  const notes = Array.isArray(p.notes) ? p.notes.filter((n) => n && typeof n.text === "string")
    .map((n) => ({ id: typeof n.id === "string" ? n.id : uid(), title: String(n.title || "Note").slice(0, 40), text: n.text })) : [];
  return { id: typeof p.id === "string" ? p.id : uid(), name: p.name.trim().slice(0, 40), sizes, prices, colors, held, variantLabel, notes, varNames, links };
}

$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  $("importActions").hidden = true;
  $("preview").innerHTML = "";
  incoming = null;
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data?.app !== "printify-size-pricer" || !Array.isArray(data.profiles)) throw new Error();
    incoming = data.profiles.map(clean).filter(Boolean);
    incomingNames = cleanNames(data.varNames);
    if (!incoming.length && !incomingNames.length) throw new Error();
    $("preview").innerHTML = `<ul>${incoming.map((p) => `<li><b>${esc(p.name)}</b>: ${p.sizes.length} sizes, ${p.colors.length} variants, ${p.notes.length} notes</li>`).join("")}${incomingNames.length ? `<li><b>Etsy variation names</b>: ${incomingNames.length}</li>` : ""}</ul>`;
    $("importActions").hidden = false;
    setStatus(`${f.name} is ready. Pick how to load it.`);
  } catch {
    setStatus("This file isn't a compatible ClickAway backup.", "err");
  }
});

async function save(profiles, activeId, varNames) {
  const act = profiles.find((p) => p.id === activeId) || profiles[0];
  await chrome.storage.local.set({ profiles, activeId: act?.id || null, prices: act?.prices || {}, varNames });
}

$("merge").addEventListener("click", async () => {
  const { profiles, activeId, varNames } = await current();
  let added = 0, updated = 0;
  for (const r of incomingNames) {
    const same = varNames.find((x) => x.from.toLowerCase() === r.from.toLowerCase());
    if (same) same.to = r.to; else varNames.push(r);
  }
  for (const p of incoming) {
    const same = profiles.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (same) { Object.assign(same, { sizes: p.sizes, prices: p.prices, colors: p.colors, held: p.held, variantLabel: p.variantLabel, notes: p.notes, varNames: p.varNames, links: p.links }); updated++; }
    else { profiles.push({ ...p, id: profiles.some((x) => x.id === p.id) ? uid() : p.id }); added++; }
  }
  await save(profiles, activeId, varNames);
  setStatus(`Done: ${added} added, ${updated} updated.`, "ok");
  $("importActions").hidden = true;
  showSummary();
});

$("replace").addEventListener("click", async () => {
  if ($("replace").dataset.armed !== "1") {
    $("replace").dataset.armed = "1";
    $("replace").textContent = "Click Again To Replace Everything";
    setTimeout(() => { $("replace").dataset.armed = ""; $("replace").textContent = "Replace Everything"; }, 3500);
    return;
  }
  await save(incoming, incoming[0]?.id, incomingNames);
  setStatus(`Done: your products were replaced with ${incoming.length} from the file.`, "ok");
  $("importActions").hidden = true;
  showSummary();
});

$("deleteAll").addEventListener("click", async () => {
  if (!confirm("Delete all saved ClickAway data from this browser? This is irreversible unless you have already exported a backup. Previously downloaded backup files will not be deleted.")) return;
  const button = $("deleteAll");
  button.disabled = true;
  try {
    await Promise.all([
      chrome.storage.local.remove(LOCAL_DATA_KEYS),
      chrome.storage.sync.remove(LEGACY_SYNC_KEYS)
    ]);
    const [local, sync] = await Promise.all([
      chrome.storage.local.get(LOCAL_DATA_KEYS),
      chrome.storage.sync.get(LEGACY_SYNC_KEYS)
    ]);
    const remaining = [...LOCAL_DATA_KEYS.filter((key) => local[key] !== undefined), ...LEGACY_SYNC_KEYS.filter((key) => sync[key] !== undefined)];
    if (remaining.length) throw new Error("Some saved data could not be removed.");
    setDeleteStatus("All ClickAway saved data was deleted. ClickAway will now reload to close open views and stop active work.", "ok");
    setTimeout(() => chrome.runtime.reload(), 750);
  } catch {
    setDeleteStatus("Couldn't verify that all saved data was deleted. Check again or try again.", "err");
    button.disabled = false;
  }
});

showSummary();
