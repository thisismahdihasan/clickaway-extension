const TSHIRT = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const $ = (id) => document.getElementById(id);
const rows = $("rows"), status = $("status");
const pickBtn = $("profile"), pickList = $("pickList"), applyBtn = $("apply");
const editBtn = $("edit"), saveBtn = $("save"), cancelBtn = $("cancel");
const nameRow = $("nameRow"), nameInput = $("nameInput");

let profiles = [], activeId = null, nameMode = null, deleteArmed = null, editing = false;

let pageUrl = "";
const uid = () => Math.random().toString(36).slice(2, 10);
const active = () => profiles.find((p) => p.id === activeId);
const inputs = () => [...rows.querySelectorAll("input.price")];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function setStatus(text, cls = "") { status.textContent = text; status.className = cls; }

async function persist() {
  await chrome.storage.local.set({ profiles, activeId, prices: active()?.prices || {} });
}

async function loadState() {
  const loc = await chrome.storage.local.get("profiles");
  if (!loc.profiles) {
    const syn = await chrome.storage.sync.get(["profiles", "activeId", "prices"]);
    if (syn.profiles || syn.prices) await chrome.storage.local.set(syn);
  }
  const d = await chrome.storage.local.get(["profiles", "activeId", "prices"]);
  const oldPrices = d.prices && Object.keys(d.prices).length ? d.prices : null;
  profiles = Array.isArray(d.profiles) ? d.profiles
    : oldPrices ? [{ id: uid(), name: "My T-shirt", prices: oldPrices }] : [];
  // remove an empty demo product left by older versions
  profiles = profiles.filter((p) => !(p.name === "My T-shirt" && !Object.keys(p.prices || {}).length &&
    !(p.colors || []).length && !(p.notes || []).length && !(p.links || []).length));
  for (const p of profiles) {
    if (!Array.isArray(p.sizes)) p.sizes = [...TSHIRT];
  }
  activeId = profiles.some((p) => p.id === d.activeId) ? d.activeId : profiles[0]?.id || null;
  await persist();
}

function rowHtml(size, price, edit) {
  const label = edit
    ? `<input class="tag" value="${esc(size)}" maxlength="20" placeholder="Size" aria-label="Size name">`
    : `<div class="tag" title="${esc(size)}">${esc(size)}</div>`;
  return `${label}
    <label class="field${edit ? "" : " locked"}"><span>$</span>
    <input class="price" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00"
      value="${esc(price ?? "")}" ${edit ? "" : "readonly"} aria-label="${esc(size)} price"></label>
    ${edit ? '<button class="rm" title="Remove size" aria-label="Remove size">✕</button>' : ""}`;
}

function addRow(size = "", price = "", edit = editing) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = rowHtml(size, price, edit);
  row.querySelector(".rm")?.addEventListener("click", () => { row.remove(); showEmpty(); });
  rows.appendChild(row);
  return row;
}

function showEmpty() {
  rows.querySelector(".empty")?.remove();
  if (!rows.querySelector(".row")) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = editing ? "No sizes yet. Click + Add size." : "No sizes yet. Click Edit to add them.";
    rows.appendChild(e);
  }
}

function drawRows() {
  rows.innerHTML = "";
  const p = active();
  for (const sz of p?.sizes || []) addRow(sz, p.prices?.[sz]);
  showEmpty();
}

let draftColors = [];

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function labelFor(label, n) {
  const l = (label || "variants").trim() || "variants";
  if (n !== 1 || /ss$/i.test(l)) return l;
  if (/(sh|ch|x)es$/i.test(l)) return l.slice(0, -2);
  return /s$/i.test(l) ? l.slice(0, -1) : l;
}
const curLabel = () => (editing ? $("labelInput").value : active()?.variantLabel) || "variants";

function drawLabel() {
  const l = curLabel();
  $("varTitle").textContent = cap(l);
  const tc = (t) => t.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  $("colorsBtn").querySelector(".txt b").textContent = tc(`Select ${l} on this page`);
}

// "On hold": stays in your list but is not ticked on Printify (and gets unticked if it is)
let draftHeld = [];
const isHeld = (name, held) => (held || []).some((h) => h.toUpperCase() === name.toUpperCase());
const activeColors = (p) => (p?.colors || []).filter((c) => !isHeld(c, p?.held));

async function toggleHoldNow(name) {
  const p = active();
  p.held = isHeld(name, p.held) ? p.held.filter((h) => h.toUpperCase() !== name.toUpperCase()) : [...(p.held || []), name];
  await persist();
  drawColors();
  setStatus(isHeld(name, p.held) ? `"${name}" is on hold. It won't be selected on Printify.` : `"${name}" is back. It will be selected again.`, "ok");
}

function drawColors() {
  const box = $("colorChips");
  box.innerHTML = "";
  const list = editing ? draftColors : (active()?.colors || []);
  const held = editing ? draftHeld : (active()?.held || []);
  const nHeld = list.filter((c) => isHeld(c, held)).length;
  $("colorCount").textContent = list.length ? `(${list.length - nHeld}${nHeld ? ` + ${nHeld} on hold` : ""})` : "";
  if (!list.length) {
    const n = document.createElement("span");
    n.className = "none";
    n.style.fontSize = "12px"; n.style.color = "var(--muted)";
    n.textContent = editing ? "Add the options to tick for this product: colors, phone models, surfaces…" : "No variants yet. Click Edit to add them.";
    box.appendChild(n);
  }
  box.classList.toggle("editing", editing);
  list.forEach((c, i) => {
    const onHold = isHeld(c, held);
    const chip = document.createElement(editing ? "div" : "button");
    chip.className = (editing ? "crow" : "chip") + (onHold ? " held" : "");
    if (editing) {
      chip.innerHTML = `<span class="num">${i + 1}</span><span class="cname">${esc(c)}</span>${onHold ? '<em class="hb">on hold</em>' : ""}
        <button class="mv" data-d="-1" title="Move up" aria-label="Move ${esc(c)} up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="mv" data-d="1" title="Move down" aria-label="Move ${esc(c)} down" ${i === list.length - 1 ? "disabled" : ""}>↓</button>
        <button class="hold" title="${onHold ? "Resume: select it again" : "Hold: keep in list, don't select"}" aria-label="${onHold ? "Resume" : "Hold"} ${esc(c)}">${onHold ? "▶" : "⏸"}</button>
        <button class="rmc" title="Remove" aria-label="Remove ${esc(c)}">✕</button>`;
      chip.querySelector(".hold").addEventListener("click", () => {
        draftHeld = onHold ? draftHeld.filter((h) => h.toUpperCase() !== c.toUpperCase()) : [...draftHeld, c];
        drawColors();
        box.querySelectorAll(".crow")[i]?.querySelector(".hold")?.focus();
      });
      chip.querySelectorAll(".mv").forEach((b) => b.addEventListener("click", () => {
        const j = i + Number(b.dataset.d);
        [draftColors[i], draftColors[j]] = [draftColors[j], draftColors[i]];
        drawColors();
        box.querySelectorAll(".crow")[j]?.querySelector(`.mv[data-d="${b.dataset.d}"]:not(:disabled)`)?.focus();
      }));
      chip.querySelector(".rmc").addEventListener("click", () => {
        draftColors.splice(i, 1);
        draftHeld = draftHeld.filter((h) => h.toUpperCase() !== c.toUpperCase());
        drawColors();
      });
    } else {
      chip.style.paddingRight = "8px";
      chip.title = onHold ? "On hold. Click to select it again" : "Click to put on hold";
      chip.innerHTML = `<span><b class="n">${i + 1}.</b> ${esc(c)}${onHold ? " ⏸" : ""}</span>`;
      chip.addEventListener("click", () => toggleHoldNow(c));
    }
    box.appendChild(chip);
  });
  $("colorAddRow").hidden = !editing;
  $("labelRow").hidden = !editing;
  drawLabel();
  $("colorsBtn").disabled = editing || !activeColors(active()).length;
}

function addColorsFromInput() {
  const parts = $("colorInput").value.split(/[,\n]/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const c of parts) if (!draftColors.some((d) => d.toLowerCase() === c.toLowerCase())) draftColors.push(c);
  $("colorInput").value = "";
  drawColors();
  $("colorInput").focus();
}
$("colorAdd").addEventListener("click", addColorsFromInput);
$("labelInput").addEventListener("input", drawLabel);
$("colorInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addColorsFromInput(); } });

function render() {
  const none = !profiles.length;
  $("emptyState").hidden = !none;
  $("autoBox").hidden = none;
  $("work").hidden = none;
  ["renameP", "dupP"].forEach((id) => ($(id).disabled = none));
  pickBtn.disabled = none;
  $("pickName").textContent = active()?.name || "No products";
  pickBtn.title = active()?.name || "";
  closePicker();
  drawRows();
  drawColors();
  drawNotes();
  drawLinked();
  drawPageBar();
  if (typeof drawVN === "function" && $("vnEdit").hidden) drawVN(false);
  $("deleteP").disabled = none;
  document.querySelector(".pick").hidden = none;
  document.querySelector(".links").hidden = none;
  document.querySelector(".product label.sec").hidden = none;
  drawActions();
}

// Show only the actions that have something saved; highlight the one for this page
function drawActions() {
  const p = active();
  const url = pageUrl || "";
  const show = {
    apply: !!p && Object.keys(p.prices || {}).length > 0,
    colorsBtn: !!p && activeColors(p).length > 0,
    vnApply: curNames().length > 0 || /multi-product-listing/.test(url)
  };
  const here = /product-details/.test(url) ? "apply" : /\/app\/editor\//.test(url) ? "colorsBtn" : /multi-product-listing/.test(url) ? "vnApply" : "";
  for (const id of ["apply", "colorsBtn", "vnApply"]) {
    $(id).hidden = !show[id];
    $(id).classList.toggle("here", id === here && show[id]);
  }
  // put the action for this page first
  if (here && show[here]) $(here).parentElement.prepend($(here));
  $("actsHead").hidden = !Object.values(show).some(Boolean);
  // always available for a product, so you can add the first names
  $("vnBox").hidden = !active();
}

// ----- notes: saved texts per product, one click copies -----
let noteEditId = null, noteDeleteArmed = false;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = document.createElement("textarea");
    t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

function drawNotes() {
  const list = active()?.notes || [];
  $("noteCount").textContent = list.length ? `(${list.length})` : "";
  const box = $("noteList");
  box.innerHTML = "";
  if (!list.length && $("noteForm").hidden) {
    const e = document.createElement("div");
    e.className = "none";
    e.style.fontSize = "12px"; e.style.color = "var(--muted)";
    e.textContent = "Save a description, tags, or anything you paste often.";
    box.appendChild(e);
  }
  for (const n of list) {
    const row = document.createElement("div");
    row.className = "note";
    const preview = n.text.replace(/\s+/g, " ").trim();
    row.innerHTML = `<button class="note-copy" title="Click to copy">
        <span class="note-top"><span class="note-title">${esc(n.title)}</span><span class="note-state">Copy</span></span>
        <span class="note-prev">${esc(preview.slice(0, 120))}</span>
      </button>
      <button class="note-edit" title="Edit note" aria-label="Edit ${esc(n.title)}">✎</button>`;
    row.querySelector(".note-copy").addEventListener("click", async () => {
      const ok = await copyText(n.text);
      const st = row.querySelector(".note-state");
      row.classList.toggle("copied", ok);
      st.textContent = ok ? "✓ Copied" : "Copy failed";
      setStatus(ok ? `Copied "${n.title}".` : "Couldn't copy. Try again.", ok ? "ok" : "err");
      clearTimeout(row._t);
      row._t = setTimeout(() => { row.classList.remove("copied"); st.textContent = "Copy"; }, 1500);
    });
    row.querySelector(".note-edit").addEventListener("click", () => openNote(n.id));
    box.appendChild(row);
  }
}

function openNote(id) {
  const n = (active()?.notes || []).find((x) => x.id === id);
  noteEditId = n ? n.id : null;
  noteDeleteArmed = false;
  $("noteTitle").value = n ? n.title : "";
  $("noteText").value = n ? n.text : "";
  $("noteDelete").hidden = !n;
  $("noteDelete").textContent = "Delete";
  $("noteForm").hidden = false;
  $("addNote").hidden = true;
  updateChars();
  drawNotes();
  (n ? $("noteText") : $("noteTitle")).focus();
  $("noteForm").scrollIntoView({ block: "nearest" });
}

function closeNote() {
  noteEditId = null;
  $("noteForm").hidden = true;
  $("addNote").hidden = false;
  drawNotes();
}

function updateChars() {
  const n = $("noteText").value.length;
  $("noteChars").textContent = n ? `${n.toLocaleString()} characters` : "";
}

async function saveNote() {
  const title = $("noteTitle").value.replace(/\s+/g, " ").trim() || "Note";
  const text = $("noteText").value;
  if (!text.trim()) { setStatus("Write or paste some text first.", "err"); $("noteText").focus(); return; }
  const notes = active().notes || (active().notes = []);
  if (noteEditId) Object.assign(notes.find((x) => x.id === noteEditId), { title, text });
  else notes.push({ id: uid(), title, text });
  await persist();
  closeNote();
  setStatus(`Saved note "${title}".`, "ok");
}

$("addNote").addEventListener("click", () => openNote(null));
$("noteCancel").addEventListener("click", closeNote);
$("noteSave").addEventListener("click", saveNote);
$("noteText").addEventListener("input", updateChars);
$("noteForm").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeNote(); }
});
$("noteTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("noteText").focus(); } });
$("noteDelete").addEventListener("click", async () => {
  if (!noteDeleteArmed) {
    noteDeleteArmed = true;
    $("noteDelete").textContent = "Click Again To Delete";
    setTimeout(() => { noteDeleteArmed = false; $("noteDelete").textContent = "Delete"; }, 3000);
    return;
  }
  const n = active().notes.find((x) => x.id === noteEditId);
  active().notes = active().notes.filter((x) => x.id !== noteEditId);
  await persist();
  closeNote();
  setStatus(`Deleted note "${n?.title || ""}".`, "ok");
});

// ----- auto-select links -----
let page = null, pageIdx = 0; // { names, matchId }

function drawLinked() {
  const box = $("chips");
  box.innerHTML = "";
  const links = active()?.links || [];
  if (!links.length) {
    const n = document.createElement("span");
    n.className = "none";
    n.textContent = "nothing yet";
    box.appendChild(n);
    return;
  }
  for (const l of links) {
    const c = document.createElement("span");
    c.className = "chip";
    c.innerHTML = `<span title="${esc(l)}">${esc(l)}</span><button title="Unlink" aria-label="Unlink ${esc(l)}">✕</button>`;
    c.querySelector("button").addEventListener("click", async () => {
      active().links = active().links.filter((x) => x !== l);
      await persist(); render();
      setStatus(`Unlinked "${l}".`, "ok");
    });
    box.appendChild(c);
  }
}

function drawPageBar() {
  const st = $("pageState");
  st.innerHTML = "";
  if (!active()) { st.hidden = true; return; }
  if (!page || !page.names?.length) { st.hidden = true; return; }
  st.hidden = false;
  const name = page.names[0];
  const hay = page.names.join(" \n ").toLowerCase();
  const owner = profiles.find((p) => (p.links || []).some((l) => hay.includes(l.toLowerCase())));
  if (owner && owner.id === activeId) {
    st.innerHTML = `<span class="ok-dot">✓ Linked to "${esc(owner.name)}"</span>`;
    return;
  }
  st.innerHTML = owner
    ? `<span class="warn">This page is linked to "${esc(owner.name)}".</span>`
    : `<span class="warn">This page isn't linked yet.</span>`;
  const b = document.createElement("button");
  b.className = "link";
  b.textContent = `Link This Page To "${active().name}"`;
  b.title = `Page name: ${name}`;
  b.addEventListener("click", () => linkPage(name));
  st.appendChild(b);
}

async function linkPage(name) {
  for (const p of profiles) p.links = (p.links || []).filter((l) => l.toLowerCase() !== name.toLowerCase());
  if (!(active().links || []).some((l) => l.toLowerCase() === name.toLowerCase()))
    active().links = [...(active().links || []), name];
  await persist();
  render();
  setStatus(`"${active().name}" will be picked automatically on "${name}".`, "ok");
}

function lockProfileControls(lock) {
  ["profile", "newP", "renameP", "dupP", "deleteP", "backup"].forEach((id) => ($(id).disabled = lock));
  if (!lock) { const none = !profiles.length; ["deleteP", "renameP", "dupP", "profile"].forEach((id) => ($(id).disabled = none)); }
}

function setEditing(on) {
  if (on && !editing) { draftColors = [...(active()?.colors || [])]; draftHeld = [...(active()?.held || [])]; $("labelInput").value = active()?.variantLabel || ""; }
  editing = on;
  // Keep what's typed while switching modes
  const cur = [...rows.querySelectorAll(".row")].map((r) => [
    r.querySelector("input.tag")?.value ?? r.querySelector(".tag").textContent,
    r.querySelector("input.price").value
  ]);
  rows.innerHTML = "";
  cur.forEach(([sz, pr]) => addRow(sz, pr, on));
  showEmpty();
  $("sizeTools").hidden = !on;
  drawColors();
  editBtn.hidden = on; saveBtn.hidden = !on; cancelBtn.hidden = !on;
  applyBtn.disabled = on;
  lockProfileControls(on);
  if (on && active()) {
    (rows.querySelector("input.tag") || $("addSize")).focus();
    setStatus(`Editing "${active().name}". Write sizes and variants exactly as Printify shows them.`);
  }
}

$("addSize").addEventListener("click", () => {
  rows.querySelector(".empty")?.remove();
  addRow("", "", true).querySelector("input.tag").focus();
});
// ----- product (profile) controls -----
// Custom product list (the native dropdown jumps around when the popup changes size)
let hl = -1;
function drawPicker() {
  pickList.innerHTML = "";
  const linkedHere = page?.matchId;
  profiles.forEach((p, i) => {
    const o = document.createElement("button");
    o.className = "pick-opt" + (i === hl ? " hl" : "");
    o.setAttribute("role", "option");
    o.setAttribute("aria-selected", String(p.id === activeId));
    o.innerHTML = `<b class="tick">${p.id === activeId ? "✓" : ""}</b><span title="${esc(p.name)}">${esc(p.name)}</span>` +
      (p.id === linkedHere ? "<small>this page</small>" : "");
    o.addEventListener("click", () => choose(p.id));
    pickList.appendChild(o);
  });
}
function openPicker() {
  if (pickBtn.disabled) return;
  hl = profiles.findIndex((p) => p.id === activeId);
  drawPicker();
  pickList.hidden = false;
  pickBtn.setAttribute("aria-expanded", "true");
  pickList.children[hl]?.scrollIntoView({ block: "nearest" });
}
function closePicker() { pickList.hidden = true; pickBtn.setAttribute("aria-expanded", "false"); }
async function choose(id) {
  closePicker();
  pickBtn.focus();
  if (id === activeId) return;
  if (!$("noteForm").hidden) closeNote();
  activeId = id;
  // Remember the choice for this page so auto-select doesn't switch it back
  if (page?.url) await chrome.storage.local.set({ pinned: { id, path: page.url } });
  await persist();
  render();
  setStatus(`Using "${active().name}".`, "ok");
}
pickBtn.addEventListener("click", () => (pickList.hidden ? openPicker() : closePicker()));
pickBtn.addEventListener("keydown", (e) => {
  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    if (pickList.hidden) return openPicker();
    hl = (hl + (e.key === "ArrowDown" ? 1 : -1) + profiles.length) % profiles.length;
    drawPicker();
    pickList.children[hl]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && !pickList.hidden) { e.preventDefault(); choose(profiles[hl].id); }
  else if (e.key === "Escape" && !pickList.hidden) { e.preventDefault(); e.stopPropagation(); closePicker(); }
});
document.addEventListener("click", (e) => { if (!e.target.closest(".picker")) closePicker(); });

function openName(mode) {
  nameMode = mode;
  nameRow.hidden = false;
  nameInput.value = mode === "rename" ? active().name : mode === "dup" ? active().name + " copy" : "";
  nameInput.focus(); nameInput.select();
  editBtn.disabled = true; applyBtn.disabled = true;
}
function closeName() { nameMode = null; nameRow.hidden = true; editBtn.disabled = false; applyBtn.disabled = false; }

$("newP").addEventListener("click", () => openName("new"));
$("renameP").addEventListener("click", () => openName("rename"));
$("dupP").addEventListener("click", () => openName("dup"));
$("nameCancel").addEventListener("click", closeName);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") $("nameOk").click(); if (e.key === "Escape") closeName(); });

$("nameOk").addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) { setStatus("Type a name first.", "err"); nameInput.focus(); return; }
  if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase() && !(nameMode === "rename" && p.id === activeId))) {
    setStatus("A product with this name already exists.", "err"); return;
  }
  const mode = nameMode;
  if (mode === "rename") active().name = name;
  else {
    const p = mode === "dup"
      ? { id: uid(), name, sizes: [...active().sizes], prices: { ...active().prices }, colors: [...(active().colors || [])], held: [...(active().held || [])], varNames: (active().varNames || []).map((r) => ({ ...r })), variantLabel: active().variantLabel || "",
          notes: (active().notes || []).map((n) => ({ ...n, id: uid() })), links: [] }
      : { id: uid(), name, sizes: [], prices: {}, colors: [], links: [] };
    profiles.push(p); activeId = p.id;
  }
  await persist();
  closeName();
  render();
  if (mode === "new") {
    setEditing(true);
    setStatus(`"${name}" created. Add sizes, enter prices, then Save.`);
  }
  else setStatus(mode === "rename" ? "Renamed." : `"${name}" created as a copy.`, "ok");
});

$("deleteP").addEventListener("click", async () => {
  if (!profiles.length) return;
  if (deleteArmed !== activeId) {
    deleteArmed = activeId;
    $("deleteP").textContent = "Click Again To Delete";
    setTimeout(() => { deleteArmed = null; $("deleteP").textContent = "Delete"; }, 3000);
    return;
  }
  const name = active().name;
  profiles = profiles.filter((p) => p.id !== activeId);
  activeId = profiles[0]?.id || null;
  deleteArmed = null; $("deleteP").textContent = "Delete";
  await persist();
  render();
  setStatus(`"${name}" deleted.`, "ok");
});

// ----- price editing -----
editBtn.addEventListener("click", () => setEditing(true));
rows.addEventListener("keydown", (e) => { if (e.key === "Enter" && !saveBtn.hidden) saveBtn.click(); });
cancelBtn.addEventListener("click", () => { editing = false; render(); setEditing(false); setStatus("Changes discarded."); });

saveBtn.addEventListener("click", async () => {
  const sizes = [], prices = {}, seen = new Set();
  for (const r of rows.querySelectorAll(".row")) {
    const tagIn = r.querySelector("input.tag"), priceIn = r.querySelector("input.price");
    const sz = tagIn.value.replace(/\s+/g, " ").trim();
    if (!sz && priceIn.value === "") continue;        // ignore fully empty rows
    if (!sz) { tagIn.focus(); setStatus("Give every row a size name.", "err"); return; }
    if (seen.has(sz.toUpperCase())) { tagIn.focus(); setStatus(`"${sz}" is listed twice.`, "err"); return; }
    seen.add(sz.toUpperCase());
    sizes.push(sz);
    if (priceIn.value !== "") {
      const n = parseFloat(priceIn.value);
      if (isNaN(n) || n <= 0) { priceIn.focus(); setStatus(`${sz}: enter a price above 0.`, "err"); return; }
      prices[sz] = n.toFixed(2);
    }
  }
  if ($("colorInput").value.trim()) addColorsFromInput();
  active().sizes = sizes;
  active().prices = prices;
  active().colors = [...draftColors];
  active().held = draftHeld.filter((h) => isHeld(h, draftColors));
  active().variantLabel = $("labelInput").value.replace(/\s+/g, " ").trim();
  await persist();
  editing = false;
  render();
  setEditing(false);
  setStatus(`Saved ${sizes.length} size${sizes.length === 1 ? "" : "s"} and ${active().colors.length} ${labelFor(active().variantLabel, active().colors.length)} for "${active().name}".`, "ok");
});

// ----- apply -----
async function withPage(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://printify.com/")) throw new Error("Open your Printify product pricing page first.");
  const send = () => chrome.tabs.sendMessage(tab.id, msg);
  try { return await send(); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await send();
  }
}

$("resetFabPositions").addEventListener("click", async () => {
  const button = $("resetFabPositions");
  button.disabled = true;
  try {
    await chrome.storage.local.remove("fabPositions");
    setStatus("Floating button positions reset.", "ok");
  } catch {
    setStatus("Couldn't reset floating button positions. Try again.", "err");
  } finally { button.disabled = false; }
});

applyBtn.addEventListener("click", async () => {
  const prices = active()?.prices || {};
  if (!Object.keys(prices).length) { setStatus(`"${active().name}" has no prices. Click Edit first.`, "err"); return; }
  applyBtn.disabled = true;
  setStatus(`Filling "${active().name}" prices…`);
  try {
    const res = await withPage({ type: "PF_APPLY", prices, sizes: active().sizes });
    setStatus(res.message, res.ok ? "ok" : "err");
  } catch (e) {
    setStatus(e.message.startsWith("Open") ? e.message : "Couldn't reach the page. Reload the Printify tab and try again.", "err");
  } finally { applyBtn.disabled = false; }
});

$("colorsBtn").addEventListener("click", async () => {
  const colors = activeColors(active());
  if (!colors.length) { setStatus("No variants saved. Click Edit to add them.", "err"); return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https:\/\/printify\.com\/app\/editor\//.test(tab?.url || "")) {
    setStatus("Open the product in Printify's editor (Select variants) first.", "err"); return;
  }
  $("colorsBtn").disabled = true;
  setStatus(`Selecting ${colors.length} ${labelFor(active().variantLabel, colors.length)}…`);
  try {
    const res = await withPage({ type: "PF_COLORS", colors, label: active().variantLabel });
    setStatus(res.message, res.ok ? "ok" : "err");
  } catch { setStatus("Couldn't reach the page. Reload the Printify tab and try again.", "err"); }
  finally { $("colorsBtn").disabled = false; }
});

$("backup").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ----- Etsy variation names (multi-product listing), one list for all listings -----
// Variation names now belong to each product. Old shared names (from v4.4–4.7) wait in legacyNames
// until you move them into a product.
let legacyNames = [], onMulti = false;
const curNames = () => active()?.varNames || [];

function drawVN(editing = false) {
  $("vnCount").textContent = curNames().length ? `(${curNames().length})` : "";
  $("vnEditLabel").textContent = curNames().length ? "Edit Names" : "Add Names";
  const list = $("vnList");
  list.innerHTML = "";
  list.hidden = editing;
  if (!curNames().length && !editing) {
    const e = document.createElement("div");
    e.className = "none"; e.style.fontSize = "12px"; e.style.color = "var(--muted)";
    e.textContent = onMulti ? `No names for "${active()?.name || "this product"}" yet. Click Add Names, then Read Names From This Page.` : `No names for "${active()?.name || "this product"}" yet. Click Add Names below.`;
    list.appendChild(e);
  }
  if (legacyNames.length && active() && !editing) {
    const m = document.createElement("div");
    m.className = "vn-legacy";
    m.innerHTML = `<span>${legacyNames.length} saved name${legacyNames.length === 1 ? " isn't" : "s aren't"} tied to a product yet.</span>`;
    const btn = document.createElement("button");
    btn.className = "link";
    btn.textContent = `Move To "${active().name}"`;
    btn.addEventListener("click", async () => {
      const mine = active().varNames || (active().varNames = []);
      for (const r of legacyNames) if (!mine.some((x) => x.from.toLowerCase() === r.from.toLowerCase())) mine.push(r);
      legacyNames = [];
      await chrome.storage.local.remove("varNames");
      await persist();
      drawVN(false);
      setStatus(`Variation names now belong to "${active().name}".`, "ok");
    });
    m.appendChild(btn);
    list.appendChild(m);
  }
  for (const r of curNames()) {
    const d = document.createElement("div");
    d.className = "vn-item";
    d.innerHTML = `<span class="from" title="${esc(r.from)}">${esc(r.from)}</span><span class="arrow">→</span><span class="to" title="${esc(r.to)}">${esc(r.to)}</span>`;
    list.appendChild(d);
  }
  $("vnEdit").hidden = !editing;
  $("vnView").hidden = editing;
  $("vnRead").hidden = !onMulti;
  $("vnApply").disabled = editing;
  if (typeof drawActions === "function" && profiles) drawActions();
}

function vnRow(from = "", to = "") {
  const row = document.createElement("div");
  row.className = "vn-row";
  row.innerHTML = `<input class="f" placeholder="Unisex Garment-Dyed T-shirt" aria-label="Printify product name">
    <input class="t" placeholder="T-shirt" aria-label="Name on Etsy"><button class="rm" title="Remove" aria-label="Remove">✕</button>`;
  row.querySelector(".f").value = from;
  row.querySelector(".t").value = to;
  row.querySelector(".rm").addEventListener("click", () => row.remove());
  $("vnRows").appendChild(row);
  return row;
}

function openVN() {
  $("vnRows").innerHTML = "";
  curNames().forEach((r) => vnRow(r.from, r.to));
  if (!curNames().length) vnRow();
  drawVN(true);
  $("vnRows").querySelector("input")?.focus();
}

$("vnEditBtn").addEventListener("click", openVN);
$("vnCancel").addEventListener("click", () => { drawVN(false); setStatus("Changes discarded."); });
$("vnAdd").addEventListener("click", () => vnRow().querySelector(".f").focus());
$("vnRead").addEventListener("click", async () => {
  try {
    const res = await withPage({ type: "PF_NAMES_READ" });
    const have = new Set([...$("vnRows").querySelectorAll(".f")].map((i) => i.value.trim().toLowerCase()));
    let added = 0;
    for (const it of res.items || []) {
      if (!it.name || have.has(it.name.toLowerCase())) continue;
      // fill an empty row first
      const empty = [...$("vnRows").querySelectorAll(".vn-row")].find((r) => !r.querySelector(".f").value.trim());
      if (empty) { empty.querySelector(".f").value = it.name; empty.querySelector(".t").value = it.value || ""; }
      else vnRow(it.name, it.value || "");
      have.add(it.name.toLowerCase()); added++;
    }
    setStatus(added ? `Added ${added} product${added === 1 ? "" : "s"} from this page. Change the Etsy names, then Save.` : "All products on this page are already in the list.", "ok");
  } catch { setStatus("Couldn't read this page. Reload the Printify tab and try again.", "err"); }
});
$("vnSave").addEventListener("click", async () => {
  const out = [], seen = new Set();
  for (const r of $("vnRows").querySelectorAll(".vn-row")) {
    const from = r.querySelector(".f").value.replace(/\s+/g, " ").trim();
    const to = r.querySelector(".t").value.replace(/\s+/g, " ").trim();
    if (!from && !to) continue;
    if (!from) { r.querySelector(".f").focus(); setStatus("Write the Printify product name for every row.", "err"); return; }
    if (!to) { r.querySelector(".t").focus(); setStatus(`Write the Etsy name for "${from}".`, "err"); return; }
    if (seen.has(from.toLowerCase())) { r.querySelector(".f").focus(); setStatus(`"${from}" is listed twice.`, "err"); return; }
    seen.add(from.toLowerCase());
    out.push({ from, to });
  }
  if (!active()) { setStatus("Add a product first.", "err"); return; }
  active().varNames = out;
  await persist();
  drawVN(false);
  setStatus(`Saved ${out.length} variation name${out.length === 1 ? "" : "s"} for "${active().name}".`, "ok");
});
$("vnRows").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("vnSave").click(); } });
$("vnApply").addEventListener("click", async () => {
  if (!curNames().length) { $("vnBox").hidden = false; $("vnBox").open = true; setStatus(`"${active()?.name || "This product"}" has no variation names yet. Add them below.`, "err"); return; }
  if (!onMulti) { setStatus("Open a multi-product listing (Listing details tab) first.", "err"); return; }
  $("vnApply").disabled = true;
  setStatus("Setting variation names…");
  try {
    const res = await withPage({ type: "PF_NAMES_SET", list: curNames() });
    setStatus(res.message, res.ok ? "ok" : "err");
  } catch { setStatus("Couldn't reach the page. Reload the Printify tab and try again.", "err"); }
  finally { $("vnApply").disabled = false; }
});

// ----- init -----
$("startNew").addEventListener("click", () => $("newP").click());
(async () => {
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    pageUrl = t?.url || "";
    onMulti = /^https:\/\/printify\.com\/app\/multi-product-listing/.test(t?.url || "");
  } catch {}
  ({ varNames: legacyNames = [] } = await chrome.storage.local.get("varNames"));
  drawVN(false);
  if (onMulti || legacyNames.length) $("vnBox").open = true;
  await loadState();
  // Show your saved data right away; page details are added a moment later
  render();
  setEditing(false);
  const showStatus = () => {
    if (!active()) setStatus("");
    else setStatus(Object.keys(active().prices || {}).length ? `Using "${active().name}".` : "No prices yet. Click Edit to add them.");
  };
  showStatus();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith("https://printify.com/app/")) {
      const ask = () => Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: "PF_PAGE" }),
        new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 1500))
      ]);
      try { page = await ask(); }
      catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        page = await ask();
      }
      page.url = new URL(tab.url).pathname;
      if (!editing && pickList.hidden && nameRow.hidden) {
        const { pinned } = await chrome.storage.local.get("pinned");
        const pinnedHere = pinned && pinned.path === page.url && profiles.some((p) => p.id === pinned.id);
        const before = activeId;
        if (pinnedHere) activeId = pinned.id;
        else if (page?.matchId && page.matchId !== activeId && profiles.some((p) => p.id === page.matchId)) activeId = page.matchId;
        if (activeId !== before) await persist();
        render();
        showStatus();
      }
    }
  } catch {}
})();
