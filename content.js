(() => {
  // Keep these in sync with components/clico/clico.js. API version covers the
  // method contract; component revision covers any JS or CSS asset change.
  const Clico = globalThis.ClickAwayClico;
  const CLICO_API_VERSION = 3;
  const CLICO_COMPONENT_REVISION = 12;
  const clicoMethods = ["markup", "setState", "success", "outcome", "failure", "cleanup"];
  if (Clico?.version !== CLICO_API_VERSION || Clico?.revision !== CLICO_COMPONENT_REVISION || clicoMethods.some((method) => typeof Clico[method] !== "function")) {
    console.error("[ClickAway] The required Clico API/component revision is unavailable or incomplete; content-script initialization stopped.");
    return;
  }

  // Skip if a live copy is already running; replace a dead copy left over from an extension reload
  const prev = window.__pfSP;
  if (prev && prev.alive() && prev.clicoVersion === Clico.version && prev.clicoRevision === Clico.revision) return;
  if (prev) {
    dismissToast();
    document.querySelectorAll(".pf-sp-clico-introduction").forEach((intro) => intro.remove());
    clearInterval(prev.timer);
    prev.obs?.disconnect();
    for (const id of ["pf-sp-btn", "pf-sp-cbtn", "pf-sp-nbtn"]) {
      const oldButton = document.getElementById(id);
      globalThis.ClickAwayClico?.cleanup(oldButton);
      oldButton?.remove();
    }
  }
  window.__pfSP = { alive: () => { try { return !!chrome.runtime?.id; } catch { return false; } }, clicoVersion: Clico.version, clicoRevision: Clico.revision, timer: 0 };

  // One job at a time; the floating button shows progress and can stop the job
  const run = { busy: false, stop: false, btn: null };
  function checkStop() { if (run.stop) throw new Error("Stopped. Nothing else was changed."); }
  function progress(text) {
    if (!run.btn) return;
    if (["pf-sp-btn", "pf-sp-cbtn"].includes(run.btn.id)) actionFabProgress(run.btn, text);
    else run.btn.textContent = text + "  ·  ✕ stop";
  }
  async function runJob(btn, fn) {
    if (run.busy) {
      run.stop = true;
      if (["pf-sp-btn", "pf-sp-cbtn"].includes(btn?.id)) actionFabProgress(btn, "Stopping…");
      else if (btn) btn.textContent = "Stopping…";
      return null;
    }
    dismissClicoBubble();
    removeAllClicoIntroductions();
    run.busy = true; run.stop = false; run.btn = btn;
    if (["pf-sp-btn", "pf-sp-cbtn"].includes(btn?.id)) Clico.setState(btn, "working");
    try { return await fn(); }
    finally { run.busy = false; run.stop = false; run.btn = null; try { await cdp({ cdp: "detach" }); } catch {} updateButtonLabel(); updateNamesLabel(); }
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && run.busy) run.stop = true; }, true);

  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Deepest visible element whose text matches
  // Finds the deepest visible elements whose text matches. Walks the page's text once (fast),
  // instead of reading every element against every other element.
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "svg", "SVG"]);
  function findText(match, root) {
    root = root || document.body;
    if (!root) return [];
    const memo = new Map(), hits = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      let el = n.parentElement;
      for (let i = 0; i < 6 && el && el !== document.body; i++, el = el.parentElement) {
        let ok = memo.get(el);
        if (ok === undefined) {
          // big containers and our own buttons never hold the label we look for (checked once per element)
          if (SKIP_TAGS.has(el.tagName) || el.id?.startsWith("pf-sp-") || el.childElementCount > 30) ok = "stop";
          else {
            const t = el.textContent;
            ok = t.length <= 400 && match(norm(t));
            if (ok) hits.push(el);
          }
          memo.set(el, ok);
        }
        if (ok) break;
      }
    }
    const vis = hits.filter(visible);
    return vis.filter((el) => !vis.some((o) => o !== el && el.contains(o)));
  }


  function getColumns() {
    const retail = findText((t) => /^Retail price\b/i.test(t) && t.length <= 20)[0];
    const profit = findText((t) => /^Profit$/i.test(t))[0] ||
                   findText((t) => /^Profit\b/i.test(t) && t.length <= 10)[0];
    const size = findText((t) => /^Size$/i.test(t))[0];
    const color = findText((t) => /^Color$/i.test(t))[0];
    return { retail, profit, size, color };
  }

  function rowOf(el) {
    let n = el;
    while (n && n !== document.body) {
      const r = n.getBoundingClientRect();
      if (n.tagName === "TR" || n.getAttribute("role") === "row") return n;
      if (r.width > 700 && r.height < 140) return n;
      n = n.parentElement;
    }
    return null;
  }

  // ---------- "Edit price" flow ----------

  // Finds the main row label for a size (works for any size name: S, 4XL, 9oz, 11" x 14"…)
  function groupLabel(size) {
    const want = norm(size).toUpperCase();
    const retail = getColumns().retail;
    const rr = retail ? retail.getBoundingClientRect() : null;
    const inTable = (el) => {
      if (!rr) return true;
      const r = el.getBoundingClientRect();
      return r.top > rr.bottom - 2 && r.right < rr.left;
    };
    const labels = findText((t) => t.toUpperCase() === want).filter(inTable)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (!labels.length) return null;
    // Prefer the grouped row ("13 colors", "4 variants"…) on the same line
    const groupEls = findText((t) => /^\d+\s+(colou?rs?|variants?|scents?|options?|styles?)$/i.test(t));
    for (const l of labels) {
      const lr = l.getBoundingClientRect();
      const ly = lr.top + lr.height / 2;
      if (groupEls.some((c) => { const cr = c.getBoundingClientRect(); return Math.abs(cr.top + cr.height / 2 - ly) < 14 && cr.left > lr.right; }))
        return l;
    }
    // Otherwise the first row with that size
    return labels[0];
  }

  const visibleInputs = () => [...document.querySelectorAll("input")]
    .filter((i) => !["checkbox", "radio", "hidden"].includes(i.type) && visible(i) && !i.disabled);

  // ---------- Inline edit on the size row (e.g. "S · 13 colors") ----------
  function retailInputAt(y) {
    const h = getColumns().retail.getBoundingClientRect();
    const p = getColumns().profit;
    const xMax = p ? p.getBoundingClientRect().left - 2 : h.right + 120;
    const a = document.activeElement;
    const cands = visibleInputs().filter((i) => {
      const r = i.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return cx >= h.left - 40 && cx <= xMax && Math.abs(cy - y) < 25;
    });
    if (a && cands.includes(a)) return a;
    return cands[0] || null;
  }

  async function waitFor(fn, ms = 2500, step = 120) {
    const end = Date.now() + ms;
    while (Date.now() < end) { checkStop(); try { if (fn()) return true; } catch {} await sleep(step); }
    return false;
  }

  // Waits until the pricing table stops changing (Printify recalculates after each edit)
  async function settle(max = 1500) {
    const snap = () => { const r = getColumns().retail; const t = r && r.closest("table, [role='table'], [role='grid']"); return norm((t || document.body).textContent).length + "|" + document.querySelectorAll("input").length; };
    let prev = snap();
    const end = Date.now() + max;
    while (Date.now() < end) {
      await sleep(120);
      const cur = snap();
      if (cur === prev) return;
      prev = cur;
    }
  }

  async function cdp(msg) {
    const r = await chrome.runtime.sendMessage(msg);
    if (!r?.ok) throw new Error(r?.error || "real click failed");
  }

  // Clicks an empty spot so the last open price box closes and saves
  async function commit() {
    const el = findText((t) => /^important info about pricing$/i.test(t))[0];
    if (el) {
      el.scrollIntoView({ block: "center" });
      await sleep(100);
      const r = el.getBoundingClientRect();
      await cdp({ cdp: "click", x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) });
    }
    const a = document.activeElement;
    if (a && a.tagName === "INPUT") { a.blur(); a.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }
    await sleep(200);
  }

  async function editRow(size, price) {
    await settle();
    const lab = groupLabel(size);
    if (!lab) throw new Error("row not found");
    lab.scrollIntoView({ block: "center" });
    await sleep(120);
    const lr = lab.getBoundingClientRect();
    const y = Math.round(lr.top + lr.height / 2);
    const x = Math.round(getColumns().retail.getBoundingClientRect().left + 30);

    let inp = null;
    for (let c = 0; c < 2 && !inp; c++) {
      await cdp({ cdp: "click", x, y });
      await waitFor(() => (inp = retailInputAt(y)), 1200, 60);
    }
    if (!inp) throw new Error("price box didn't open");
    if (document.activeElement !== inp) {
      const r = inp.getBoundingClientRect();
      await cdp({ cdp: "click", x: Math.round(r.right - 12), y: Math.round(r.top + r.height / 2) });
      await waitFor(() => document.activeElement === inp, 600, 50);
    }
    await cdp({ cdp: "type", text: price });
    await cdp({ cdp: "tab" }); // leaving the box saves the price
    await sleep(150);
  }

  function rowShows(size, price) {
    const lab = groupLabel(size);
    const row = lab && rowOf(lab);
    if (!row) return false;
    const re = new RegExp("USD\\s*" + price.replace(".", "\\.") + "(?!\\d)(?!\\s*-)");
    return re.test(norm(row.textContent));
  }

  async function applyPrices(prices, sizes) {
    const clean = {};
    for (const [k, v] of Object.entries(prices || {})) {
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) clean[norm(k).toUpperCase()] = n.toFixed(2);
    }
    if (!Object.keys(clean).length) throw new Error("No prices saved yet. Open the extension popup and enter prices.");
    if (!getColumns().retail) throw new Error("Open Pricing → Detailed table view first.");
    const done = [], failed = [];
    const listed = (sizes || []).map((x) => norm(x).toUpperCase()).filter((x) => x in clean);
    const order = listed.length ? [...new Set(listed)]
      : Object.keys(clean).sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
    // One pass, each price typed once
    let n = 0;
    for (const size of order) {
      checkStop();
      progress(`Filling ${++n}/${order.length}: ${size}`);
      if (rowShows(size, clean[size])) continue;
      try { await editRow(size, clean[size]); }
      catch (e) { failed.push(`${size} (${e.message})`); }
    }
    await commit();
    // Let Printify finish updating, then only redo rows that are still wrong
    await sleep(500);
    await settle(2500);
    for (let round = 0; round < 2; round++) {
      const missing = order.filter((s2) => !rowShows(s2, clean[s2]));
      if (!missing.length) break;
      for (const size of missing) {
        checkStop();
        progress(`Fixing ${size}`);
        try { await editRow(size, clean[size]); } catch (e) { failed.push(`${size} (${e.message})`); }
      }
      await commit();
      await sleep(600);
      await settle(2500);
    }
    // Recount from what the table actually shows
    done.length = 0;
    const errs = Object.fromEntries(failed.map((f) => [f.split(" ")[0], f]));
    failed.length = 0;
    for (const size of order) {
      if (rowShows(size, clean[size])) done.push(`${size} $${clean[size]}`);
      else failed.push(errs[size] || `${size} (didn't stick)`);
    }
    if (failed.length) failed.push("click the green button again to retry only these");
    try { await cdp({ cdp: "detach" }); } catch {}
    return { done, failed, restored: false };
  }

  function summary(res) {
    let msg = res.done.length ? `Done: ${res.done.join(", ")}.` : "No prices were set.";
    if (res.failed.length) msg += ` Failed: ${res.failed.join("; ")}.`;
    if (res.restored) msg += " All variants re-selected.";
    return msg + " Check the table, then Save/Publish.";
  }

  // ---------- Colors on the editor page ("Select variants" panel) ----------
  function variantsPanel() {
    const h = findText((t) => /^select variants$/i.test(t))[0];
    if (!h) return null;
    let n = h.parentElement;
    while (n && n !== document.body) {
      if (/select all/i.test(n.textContent) && n.getBoundingClientRect().height > 250) return n;
      n = n.parentElement;
    }
    return null;
  }

  function selectedCount() {
    const e = findText((t) => /^\d+\s+variants?\s+selected$/i.test(t))[0];
    return e ? parseInt(norm(e.textContent), 10) : null;
  }

  // Screen point of the checkbox to the left of a label
  // ---- find the checkbox square of a colour row (only the box, never the name) ----
  function findBox(labelEl) {
    const lr = labelEl.getBoundingClientRect();
    const cy = lr.top + lr.height / 2;
    const ok = (e) => {
      if (e.contains(labelEl)) return false;
      const r = e.getBoundingClientRect();
      return r.width >= 10 && r.width <= 44 && r.height >= 10 && r.height <= 44 &&
             r.right <= lr.left + 2 && lr.left - r.right < 90 && Math.abs(r.top + r.height / 2 - cy) < 16;
    };
    let n = labelEl.parentElement;
    for (let i = 0; i < 7 && n && n !== document.body; i++, n = n.parentElement) {
      if (n.getBoundingClientRect().height > 140) break;
      const all = [...n.querySelectorAll("*")].filter(ok);
      if (!all.length) continue;
      const real = all.find((e) => e.matches("input[type='checkbox'], [role='checkbox'], [class*='checkbox' i], [class*='check' i]"));
      if (real) return real.tagName === "INPUT" ? (real.closest("label") && ok(real.closest("label")) ? real.closest("label") : real) : real;
      // square, not round (the colour dot is round) — the left-most one is the checkbox
      const sq = all.filter((e) => {
        if (e instanceof SVGElement || /^(img|picture|canvas)$/i.test(e.tagName)) return false;   // icons / colour dots
        const r = e.getBoundingClientRect();
        const round = parseFloat(getComputedStyle(e).borderTopLeftRadius) >= r.width / 2 - 1 || e.tagName.toLowerCase() === "circle";
        return Math.abs(r.width - r.height) < 9 && !round;
      }).sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
      if (sq.length) {
        // take the outer-most element of that left-most square
        let box = sq[0];
        while (box.parentElement && ok(box.parentElement)) box = box.parentElement;
        return box;
      }
    }
    return null;
  }

  const center = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };

  // Ticked or not, read at the exact spot of the checkbox: a ticked box is filled dark, an empty box is light
  function stateAt(labelEl) {
    const pt = boxPoint(labelEl, findBox(labelEl));
    // Everything drawn at that spot, smallest first (also parts that ignore the mouse)
    const row = rowOfLabel(labelEl) || labelEl.parentElement?.parentElement;
    const under = row ? [...row.querySelectorAll("*")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.width < 60 && pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
    }).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width) : [];
    for (const e of [...under, ...document.elementsFromPoint(pt.x, pt.y)]) {
      if (e.id === "pf-sp-cbtn" || e.id === "pf-sp-toast") continue;
      const inp = e.matches("input[type='checkbox']") ? e : e.querySelector?.(":scope > input[type='checkbox']");
      if (inp) return inp.checked || inp.indeterminate;
      const aria = e.getAttribute("aria-checked");
      if (aria) return aria !== "false";
      const m = getComputedStyle(e).backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (!m || (m[4] !== undefined && +m[4] < 0.3)) continue;
      return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 < 0.5;
    }
    return null;
  }

  // Scroll the row into the middle of the panel and wait until it stops moving
  async function bringIntoView(el) {
    const r0 = el.getBoundingClientRect();
    if (r0.top > 140 && r0.bottom < window.innerHeight - 140) return;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    let prev = -1;
    for (let i = 0; i < 16; i++) {
      await sleep(30);
      const t = Math.round(el.getBoundingClientRect().top);
      if (t === prev) return;
      prev = t;
    }
  }

  // Where to click: the middle of the checkbox square. The box sits about 49px left of the name.
  // Is there a colour dot between the checkbox and the name? (T-shirts: yes, phone cases: no)
  function hasDot(labelEl) {
    const lr = labelEl.getBoundingClientRect();
    const y = lr.top + lr.height / 2;
    for (let x = lr.left - 4; x > lr.left - 34; x -= 3) {
      for (const e of document.elementsFromPoint(x, y)) {
        if (e.contains(labelEl) || e.id === "pf-sp-cbtn") continue;
        const r = e.getBoundingClientRect();
        if (r.width < 6 || r.width > 30 || r.height > 30) continue;
        const round = parseFloat(getComputedStyle(e).borderTopLeftRadius) >= r.width / 2 - 1;
        if (round || e instanceof SVGElement || e.tagName === "IMG") return true;
      }
    }
    return false;
  }

  function boxPoint(labelEl, box) {
    const lr = labelEl.getBoundingClientRect();
    const y = Math.round(lr.top + lr.height / 2);
    const dot = hasDot(labelEl);
    if (box) {
      const c = center(box);
      // With a dot, the checkbox sits well left of the name; anything closer is the dot itself
      const okX = dot ? c.x <= lr.left - 32 : c.x < lr.left;
      if (okX && Math.abs(c.y - y) < 14) return c;
    }
    return { x: Math.round(lr.left - (dot ? 49 : 21)), y };
  }



  // Shows a small ring where the extension clicks, so you can see what it is doing
  function showClick(x, y) {
    const d = document.createElement("div");
    Object.assign(d.style, { position: "fixed", left: x - 9 + "px", top: y - 9 + "px", width: "18px", height: "18px",
      border: "3px solid #e11d48", borderRadius: "50%", zIndex: 2147483647, pointerEvents: "none", transition: "opacity .5s" });
    document.body.appendChild(d);
    setTimeout(() => (d.style.opacity = "0"), 500);
    setTimeout(() => d.remove(), 1100);
  }

  // Click only the checkbox of a row (a real mouse click). Returns the change in "N variants selected".
  async function clickBox(labelEl) {
    await bringIntoView(labelEl);
    // Wait until the row stops moving (the list shifts while Printify updates), then aim
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = labelEl.getBoundingClientRect();
      const k = Math.round(r.left) + "," + Math.round(r.top);
      if (k === last) break;
      last = k;
      await sleep(35);
    }
    const box = findBox(labelEl);
    const before = selectedCount();
    const pt = boxPoint(labelEl, box);
    showClick(pt.x, pt.y);
    await cdp({ cdp: "click", ...pt });
    if (before === null) { await sleep(350); return { d: 0, box }; }
    await waitFor(() => selectedCount() !== before, 1000, 25);
    await sleep(40);
    const after = selectedCount();
    return { d: after === null ? 0 : after - before, box };
  }

  // The row "header" that holds a label (checkbox + dot + name + arrow)
  function rowOfLabel(labelEl) {
    let n = labelEl.parentElement;
    while (n && n !== document.body) {
      const r = n.getBoundingClientRect();
      if (r.width >= 200 && r.height >= 24 && r.height <= 100) return n;
      if (r.height > 100) break;
      n = n.parentElement;
    }
    return null;
  }

  // Option rows in the list (colours, sizes, phone models…). Tab labels and price sub-rows are skipped.
  let TABS = [];
  function colorRows(panel) {
    return findText((t) => t.length >= 1 && t.length <= 40 &&
        !/variants? selected|select all|clear selection|select variants|\d+\s*\/\s*\d+ sizes|optimal listings|see details|maximum|#[0-9a-f]{3,6}|usd/i.test(t))
      .filter((e) => panel.contains(e) && !TABS.includes(e))
      .filter((e) => { const row = rowOfLabel(e); return !row || !/USD|\$\s?\d/.test(row.textContent); })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  // The tabs at the top of the panel (e.g. "Color · Size" or "Size · Surface")
  function getTabs(panel) {
    const head = findText((t) => /^select variants$/i.test(t)).find((e) => panel.contains(e));
    const mark = findText((t) => /^optimal listings/i.test(t) || /^(select all|clear selection)/i.test(t)).find((e) => panel.contains(e));
    const top = head ? head.getBoundingClientRect().bottom : panel.getBoundingClientRect().top;
    const bottom = mark ? mark.getBoundingClientRect().top : top + 120;
    const cands = findText((t) => t.length >= 2 && t.length <= 24 && !/select|optimal|see details/i.test(t))
      .filter((e) => panel.contains(e) && e !== head)
      .filter((e) => { const r = e.getBoundingClientRect(); return r.top >= top - 2 && r.bottom <= bottom + 2; });
    const groups = {};
    for (const e of cands) (groups[Math.round(e.getBoundingClientRect().top / 8)] ||= []).push(e);
    const best = Object.values(groups).sort((x, y) => y.length - x.length)[0] || [];
    return best.sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
  }

  // Open a tab and wait for its list to change
  async function openTab(panel, tabEl) {
    const first = () => colorRows(panel).slice(0, 3).map((e) => e.textContent).join("|");
    const before = first();
    tabEl.click();
    if (await waitFor(() => first() !== before, 1200, 60)) { await sleep(150); return true; }
    await cdp({ cdp: "click", ...center(tabEl) });
    const ok = await waitFor(() => first() !== before, 1500, 60);
    await sleep(150);
    return ok;   // false: it was already open
  }


  // The scrolling list inside the panel (more colours appear when it scrolls)
  function listScroller(panel) {
    const start = findText((t) => t.length >= 2).find((e) => panel.contains(e) && e.getBoundingClientRect().top > panel.getBoundingClientRect().top + 150) || panel;
    let n = start;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 5) return n;
      n = n.parentElement;
    }
    return null;
  }

  // Scroll the list instantly (no smooth animation) and wait until it has settled
  async function setScroll(sc, top) {
    sc.scrollTo({ top, behavior: "instant" });
    let prev = -1;
    for (let i = 0; i < 16; i++) {
      await sleep(35);
      if (sc.scrollTop === prev) break;
      prev = sc.scrollTop;
    }
    // near the bottom, give lazy-loaded rows a moment to appear
    await sleep(sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 120 ? 160 : 40);
  }

  async function clickShowMore(panel) {
    const more = findText((t) => /^(show|load|see|view) (more|all)( colou?rs)?$/i.test(t)).find((e) => panel.contains(e));
    if (more) { (more.closest("button, a, [role='button']") || more).click(); await sleep(400); return true; }
    return false;
  }

  // Find a colour's name in the list, scrolling through it if it isn't loaded yet
  async function findColorLabel(panel, tab, name) {
    const look = () => findText((t) => t.toUpperCase() === name.toUpperCase()).find((e) => panel.contains(e) && !TABS.includes(e));
    let lab = look();
    if (lab) return lab;
    const sc = listScroller(panel);
    if (!sc) return (await clickShowMore(panel)) ? look() || null : null;
    // Saved colours are usually in list order, so keep going down first; then wrap to the top once
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) await setScroll(sc, 0);
      for (let i = 0; i < 60; i++) {
        checkStop();
        if ((lab = look())) return lab;
        const prev = sc.scrollTop;
        await setScroll(sc, prev + sc.clientHeight * 0.7);
        if (sc.scrollTop === prev && !(await clickShowMore(panel))) break;   // reached the bottom
      }
      if ((lab = look())) return lab;
    }
    return null;
  }

  async function selectColors(colors) {
    try { return await selectColorsInner(colors); }
    finally { try { await cdp({ cdp: "detach" }); } catch {} }
  }

  // Walk the whole list once (fast, no clicks) and note which colours are ticked
  async function scanColors(panel) {
    const states = new Map();
    const sc = listScroller(panel);
    if (sc) await setScroll(sc, 0);
    for (let i = 0; i < 100; i++) {
      checkStop();
      const box = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      for (const lab of colorRows(panel)) {
        const key = norm(lab.textContent).toUpperCase();
        if (states.has(key)) continue;
        const r = lab.getBoundingClientRect();
        if (r.top < box.top + 4 || r.bottom > box.bottom - 4) continue;   // only rows fully in view
        if (!findBox(lab) && stateAt(lab) === null) continue;              // not a colour row
        states.set(key, { name: norm(lab.textContent), on: stateAt(lab) });
      }
      if (!sc) break;
      const prev = sc.scrollTop;
      await setScroll(sc, prev + sc.clientHeight * 0.8);
      if (sc.scrollTop === prev && !(await clickShowMore(panel))) break;
    }
    return states;
  }

  async function selectColorsInner(colors) {
    const list = (colors || []).map((c) => norm(c)).filter(Boolean);
    if (!list.length) throw new Error("No variants saved for this product. Add them in the extension popup.");
    const panel = variantsPanel();
    if (!panel) throw new Error('Open the "Select variants" panel on the right first.');
    const U = (x) => x.toUpperCase();
    const sc0 = listScroller(panel);
    if (sc0) await setScroll(sc0, 0);
    TABS = getTabs(panel);

    // 1) Check first (no clicks): find which tab holds each saved name and what is ticked
    progress("Checking");
    const groups = [];           // [{ tab, states, names }]
    let left = [...list];
    let switched = false;
    const tryTab = async (tabEl) => {
      if (tabEl && await openTab(panel, tabEl)) switched = true;
      const states = await scanColors(panel);
      const names = left.filter((n) => states.has(U(n)));
      if (names.length) { groups.push({ tab: tabEl, states, names }); left = left.filter((n) => !names.includes(n)); }
    };
    await tryTab(null);                                   // the tab that is open now
    for (const t of TABS) { if (!left.length) break; checkStop(); await tryTab(t); }
    const missing = left;
    const found = list.filter((n) => !missing.includes(n));

    const plans = groups.map((g) => {
      const wanted = new Set(g.names.map(U));
      return {
        ...g,
        toAdd: list.filter((n) => wanted.has(U(n)) && g.states.get(U(n)).on !== true),
        toRemove: [...g.states.values()].filter((v) => !wanted.has(U(v.name)) && v.on === true).map((v) => v.name)
      };
    });
    if (plans.every((p) => !p.toAdd.length && !p.toRemove.length)) {
      if (groups[0]?.tab && groups.length) await openTab(panel, groups[0].tab);
      const sc = listScroller(panel); if (sc) await setScroll(sc, 0);
      return { done: found, added: [], removed: [], missing, total: selectedCount(), already: true };
    }

    // 2) Real clicks, only where something needs to change — then check again, up to 3 rounds,
    //    so every saved option really ends up ticked
    await cdp({ cdp: "attach" });
    await sleep(250);
    const added = [], removed = [];
    let currentTab = null;
    const goTo = async (p) => {
      if (p.tab) { await openTab(panel, p.tab); currentTab = p.tab; return; }
      if (!switched) return;
      // back to the tab that was open at the start (the one holding these names)
      const has = () => findText((t) => U(t) === U(p.names[0])).some((e) => panel.contains(e) && !TABS.includes(e));
      for (const t of TABS) { if (has()) break; await openTab(panel, t); currentTab = t; }
      p.tab = currentTab;
    };

    for (let round = 1; round <= 3; round++) {
      const total = plans.reduce((a, p) => a + p.toAdd.length + p.toRemove.length, 0);
      if (!total) break;
      let n = 0;
      const tag = round > 1 ? " (fixing)" : "";
      for (const p of plans) {
        if (!p.toAdd.length && !p.toRemove.length) continue;
        await goTo(p);
        for (const name of p.toAdd) {                      // add, in your saved order
          checkStop();
          progress(`Adding ${++n}/${total}${tag}: ${name}`);
          const lab = await findColorLabel(panel, null, name);
          if (!lab) continue;
          await bringIntoView(lab);
          if (stateAt(lab) === true) continue;
          let r = await clickBox(lab);
          if (r.d < 0) r = await clickBox(lab);            // it was on after all: turn it back on
          if (r.d === 0) { await sleep(250); r = await clickBox(lab); }   // the click didn't land: once more
          if (!added.includes(name)) added.push(name);
        }
        for (const name of p.toRemove) {                   // then remove what isn't in your list
          checkStop();
          progress(`Removing ${++n}/${total}${tag}: ${name}`);
          const lab = await findColorLabel(panel, null, name);
          if (!lab) continue;
          await bringIntoView(lab);
          if (stateAt(lab) !== true) continue;
          const r = await clickBox(lab);
          if (r.d > 0) await clickBox(lab);                // it was "—" and became full: once more to clear
          if (!removed.includes(name)) removed.push(name);
        }
      }
      // Check again (no clicks): anything still wrong goes into the next round
      progress(`Checking${tag || ""}`);
      await sleep(300);
      for (const p of plans) {
        await goTo(p);
        const st = await scanColors(panel);
        const wanted = new Set(p.names.map(U));
        p.states = st;
        p.toAdd = list.filter((x) => wanted.has(U(x)) && st.has(U(x)) && st.get(U(x)).on !== true);
        p.toRemove = [...st.values()].filter((v) => !wanted.has(U(v.name)) && v.on === true).map((v) => v.name);
      }
    }

    // Final answer comes from what the page shows now
    const onNow = new Set(plans.flatMap((p) => p.names.filter((x) => p.states.get(U(x))?.on === true)));
    const done = list.filter((x) => onNow.has(x));
    const notOn = found.filter((x) => !onNow.has(x));
    const sc = listScroller(panel);
    if (sc) await setScroll(sc, 0);
    return {
      done, added: added.filter((x) => onNow.has(x)), removed: removed.filter((x) => !plans.some((p) => p.states.get(U(x))?.on === true)),
      missing: [...missing, ...notOn], total: selectedCount(), already: false
    };
  }

  // Your own name for the options ("colors", "sizes", "models"…), singular when there is one
  function labelFor(label, n) {
    const l = (label || "variants").trim() || "variants";
    if (n !== 1 || /ss$/i.test(l)) return l;
    if (/(sh|ch|x)es$/i.test(l)) return l.slice(0, -2);
    return /s$/i.test(l) ? l.slice(0, -1) : l;
  }


  function colorSummary(res, label) {
    const v = res.total !== null ? ` (${res.total} variants)` : "";
    const k = (n) => `${n} ${labelFor(label, n)}`;
    let msg;
    if (res.already) msg = `✓ Done. All ${k(res.done.length)} are already selected${v}.`;
    else {
      msg = `✓ Done. ${k(res.done.length)} selected${v}.`;
      if (res.added.length) msg += ` Added: ${res.added.join(", ")}.`;
      if (res.removed.length) msg += ` Removed: ${res.removed.join(", ")}.`;
    }
    if (res.missing.length) msg += ` Not found: ${res.missing.join(", ")}. Check the spelling matches Printify.`;
    return msg;
  }

  async function runColorsFromStorage() {
    await autoSelect(true).catch(() => {});
    await mustBeLinked();
    const p = await activeProfile();
    const held = (p.held || []).map((h) => h.toUpperCase());
    const r = await selectColors((p.colors || []).filter((c) => !held.includes(c.toUpperCase())));
    return r && { ...r, label: p.variantLabel };
  }

  // On the editor, sit just left of the right-hand panel so we never cover a colour row
  function editorRight() {
    if (!/\/app\/editor\//.test(location.pathname)) return 24;
    const head = findText((t) => /^(select variants|variants and layers)$/i.test(t))[0];
    let n = head, best = null;
    while (n && n !== document.body) {
      const r = n.getBoundingClientRect();
      if (r.width >= 280 && r.width <= 600 && r.right >= window.innerWidth - 40) best = r;
      if (r.width > 600) break;
      n = n.parentElement;
    }
    return best ? Math.round(window.innerWidth - best.left + 16) : 24;
  }

  function placeOurs() {
    const right = editorRight() + "px";
    const color = document.getElementById("pf-sp-cbtn");
    if (color && !fabPositions?.editor) setFabAnchors(color, editorRight(), 96);
    const toastEl = document.getElementById("pf-sp-toast");
    if (toastEl && toastEl.dataset.presentation !== "clico" && toastEl.style.right !== right) toastEl.style.right = right;
  }
  window.addEventListener("resize", () => {
    clampVisibleFabs(); placeOurs();
    for (const id of ["pf-sp-btn", "pf-sp-cbtn"]) {
      const button = document.getElementById(id);
      positionClicoBubble(button);
      positionClicoIntroduction(button);
    }
  });

  function addColorButton() {
    if (document.getElementById("pf-sp-cbtn")) return;
    const b = document.createElement("button");
    b.id = "pf-sp-cbtn";
    Object.assign(b.style, APPLY_BTN_STYLE);
    attachDraggableFab(b, "editor");
    b.addEventListener("click", async () => {
      try {
        const r = await runJob(b, () => { progress("Starting"); return runColorsFromStorage(); });
        if (r) {
          const ok = r.done.length > 0;
          Clico.outcome(b, ok);
          clicoOutcomeToast(b, colorSummary(r, r.label), ok ? (r.missing.length ? "partial" : "success") : "error");
        }
      } catch (e) { Clico.failure(b, e); clicoOutcomeToast(b, e.message, clicoFailureOutcome(e)); }
    });
    document.body.appendChild(b);
    restoreFabPosition(b, "editor").then(() => placeOurs());
    updateButtonLabel();
  }

  // ---------- Floating button look ----------
  const ICONS = {
    price: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>'
  };
  const titleCase = (t) => t.replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  function setBtn(b, icon, text, suffix = "") {
    const label = titleCase(text) + suffix;
    if (b.dataset.icon === icon && b.dataset.label === label && b.lastChild?.textContent === label) return;
    b.dataset.icon = icon; b.dataset.label = label;
    b.innerHTML = `<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:#d6f078;color:#1f2b22;flex:none">` +
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg></span>` +
      `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>`;
    b.lastChild.textContent = label;
  }

  const BTN_STYLE = {
    display: "flex", alignItems: "center", gap: "8px", maxWidth: "360px",
    background: "#ffffff", color: "#1f2b22", border: "1px solid #dfe4d6", borderRadius: "10px",
    padding: "6px 12px 6px 6px", font: "500 13px Inter, 'Segoe UI', system-ui, sans-serif",
    cursor: "pointer", boxShadow: "0 4px 14px rgba(16,24,18,.12)"
  };

  const APPLY_BTN_STYLE = {
    position: "fixed", right: "24px", bottom: "96px", zIndex: 2147483646,
    display: "flex", alignItems: "center", width: "52px", height: "52px", overflow: "visible",
    background: "#263428", color: "#fff", border: "1px solid #1f2b22", borderRadius: "50%",
    padding: "0", font: "500 12px/1.25 Inter, 'Segoe UI', system-ui, sans-serif", cursor: "pointer",
    boxShadow: "0 5px 16px rgba(16,24,18,.24)", transition: "width .2s ease, border-radius .2s ease, padding .2s ease"
  };

  const FAB_SIZE = 52, FAB_MARGIN = 8, FAB_WIDE = 276, FAB_POSITIONS_KEY = "fabPositions";
  let fabPositions = null;
  const clicoIntroductionTimers = new WeakMap();
  const clicoIntroductions = new WeakMap();

  const clamp = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));
  function setFabAnchors(b, right, bottom) {
    const maxRight = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN);
    const maxBottom = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN);
    b.style.left = "auto"; b.style.top = "auto";
    b.style.right = clamp(right, FAB_MARGIN, maxRight) + "px";
    b.style.bottom = clamp(bottom, FAB_MARGIN, maxBottom) + "px";
    positionClicoBubble(b);
    positionClicoIntroduction(b);
  }
  function defaultFabAnchors(key) {
    return key === "editor" ? { right: editorRight(), bottom: 96 } : { right: 24, bottom: 96 };
  }
  async function loadFabPositions() {
    if (fabPositions) return fabPositions;
    const saved = await chrome.storage.local.get(FAB_POSITIONS_KEY);
    fabPositions = saved[FAB_POSITIONS_KEY] || {};
    return fabPositions;
  }
  function applyFabPosition(b, key, saved) {
    if (!saved || !Number.isFinite(saved.rightRatio) || !Number.isFinite(saved.bottomRatio)) {
      const fallback = defaultFabAnchors(key); setFabAnchors(b, fallback.right, fallback.bottom); return;
    }
    const maxRight = Math.max(0, window.innerWidth - FAB_SIZE);
    const maxBottom = Math.max(0, window.innerHeight - FAB_SIZE);
    setFabAnchors(b, saved.rightRatio * maxRight, saved.bottomRatio * maxBottom);
  }
  async function restoreFabPosition(b, key) {
    b.dataset.fabKey = key;
    applyFabPosition(b, key, (await loadFabPositions())[key]);
  }
  async function saveFabPosition(b, key) {
    const maxRight = Math.max(1, window.innerWidth - FAB_SIZE);
    const maxBottom = Math.max(1, window.innerHeight - FAB_SIZE);
    fabPositions = await loadFabPositions();
    fabPositions[key] = {
      rightRatio: clamp(parseFloat(b.style.right) || 0, 0, maxRight) / maxRight,
      bottomRatio: clamp(parseFloat(b.style.bottom) || 0, 0, maxBottom) / maxBottom
    };
    await chrome.storage.local.set({ [FAB_POSITIONS_KEY]: fabPositions });
  }
  function clampVisibleFabs() {
    for (const [id, key] of [["pf-sp-btn", "pricing"], ["pf-sp-cbtn", "editor"]]) {
      const b = document.getElementById(id);
      if (b) applyFabPosition(b, key, fabPositions?.[key]);
    }
  }
  function collapseActionFab(b) {
    b.style.width = "52px"; b.style.borderRadius = "50%"; b.style.paddingRight = "0";
    const copy = b.querySelector(".pf-sp-apply-copy");
    if (copy) { copy.style.width = "0"; copy.style.opacity = "0"; }
    positionClicoBubble(b);
    positionClicoIntroduction(b);
  }
  function expandActionFab(b) {
    const right = parseFloat(b.style.right) || 0;
    const width = clamp(Math.min(FAB_WIDE, window.innerWidth - right - FAB_MARGIN), FAB_SIZE, FAB_WIDE);
    b.style.width = width + "px"; b.style.borderRadius = "26px"; b.style.paddingRight = width > FAB_SIZE ? "14px" : "0";
    const copy = b.querySelector(".pf-sp-apply-copy");
    if (copy) { copy.style.width = Math.max(0, width - 66) + "px"; copy.style.opacity = width > 90 ? "1" : "0"; }
    positionClicoBubble(b);
    positionClicoIntroduction(b);
  }
  function hasClicoOutcomeBubble() {
    return document.getElementById("pf-sp-toast")?.dataset.presentation === "clico";
  }
  function hasClicoOutcomeExpression(b) {
    return ["success", "error", "cancelled"].includes(b?.dataset.clicoState);
  }
  function removeClicoIntroduction(b) {
    const timer = clicoIntroductionTimers.get(b);
    if (timer) clearTimeout(timer);
    clicoIntroductionTimers.delete(b);
    const intro = clicoIntroductions.get(b);
    if (intro) intro.remove();
    clicoIntroductions.delete(b);
  }
  function removeAllClicoIntroductions() {
    for (const id of ["pf-sp-btn", "pf-sp-cbtn"]) removeClicoIntroduction(document.getElementById(id));
  }
  function positionClicoIntroduction(b) {
    const intro = clicoIntroductions.get(b);
    if (!intro || !b?.isConnected) return;
    const mascot = b.querySelector(".pf-sp-clico") || b;
    const artwork = mascot.querySelector("svg") || mascot;
    const flame = mascot.querySelector(".pf-sp-clico-flame-outer");
    const character = mascot.querySelector(".pf-sp-clico-character");
    const artworkRect = artwork.getBoundingClientRect();
    const flameRect = flame?.getBoundingClientRect();
    const characterRect = character?.getBoundingClientRect();
    const targetX = artworkRect.left + artworkRect.width / 2;
    const margin = 8, tailReach = 7, clearance = 6;
    const width = intro.offsetWidth, height = intro.offsetHeight;
    const flameTop = flameRect?.height ? flameRect.top : artworkRect.top;
    const characterBottom = characterRect?.height ? characterRect.bottom : artworkRect.bottom;
    const aboveTop = flameTop - clearance - tailReach - height;
    const belowTop = characterBottom + clearance + tailReach;
    const below = aboveTop < margin && belowTop + height <= window.innerHeight - margin;
    const left = clamp(targetX - width / 2, margin, Math.max(margin, window.innerWidth - width - margin));
    intro.style.left = left + "px";
    intro.style.top = Math.max(margin, below ? belowTop : aboveTop) + "px";
    const tail = intro.querySelector(".pf-sp-clico-intro-tail");
    if (tail) {
      const tailLeft = clamp(targetX - left - 6, 10, Math.max(10, width - 22));
      Object.assign(tail.style, below
        ? { left: tailLeft + "px", top: "-7px", bottom: "auto", clipPath: "polygon(50% 0, 0 100%, 100% 100%)" }
        : { left: tailLeft + "px", top: "auto", bottom: "-7px", clipPath: "polygon(0 0, 100% 0, 50% 100%)" });
    }
  }
  function canShowClicoIntroduction(b) {
    return !!(b?.isConnected && b.matches(":hover") && !run.busy && b.dataset.dragging !== "true" && !hasClicoOutcomeBubble() && !hasClicoOutcomeExpression(b));
  }
  function showClicoIntroduction(b) {
    if (!canShowClicoIntroduction(b) || clicoIntroductions.get(b)) return;
    const intro = document.createElement("div");
    intro.className = "pf-sp-clico-introduction";
    intro.setAttribute("aria-hidden", "true");
    intro.textContent = "Hey, I'm Clico!";
    Object.assign(intro.style, {
      position: "fixed", zIndex: 2147483647, padding: "6px 9px", border: "1px solid #afc69d",
      borderRadius: "12px", background: "#FFFEF7", color: "#263428", font: "600 11px/1.25 system-ui, sans-serif",
      boxShadow: "0 3px 10px rgba(20,36,24,.16)", pointerEvents: "none", whiteSpace: "nowrap"
    });
    const tail = document.createElement("span");
    tail.className = "pf-sp-clico-intro-tail";
    Object.assign(tail.style, { position: "absolute", width: "12px", height: "8px", background: "#FFFEF7", pointerEvents: "none" });
    intro.append(tail);
    document.body.appendChild(intro);
    clicoIntroductions.set(b, intro);
    positionClicoIntroduction(b);
  }
  function queueClicoIntroduction(b) {
    removeClicoIntroduction(b);
    if (!canShowClicoIntroduction(b)) return;
    clicoIntroductionTimers.set(b, setTimeout(() => {
      clicoIntroductionTimers.delete(b);
      showClicoIntroduction(b);
    }, 1200));
  }
  function attachFabHover(b) {
    if (b.dataset.hoverReady) return;
    b.dataset.hoverReady = "true";
    b.addEventListener("mouseenter", () => {
      if (!run.busy && b.dataset.dragging !== "true") { expandActionFab(b); Clico.setState(b, "hover"); queueClicoIntroduction(b); }
    });
    b.addEventListener("mouseleave", () => {
      removeClicoIntroduction(b);
      if (!run.busy && b.dataset.dragging !== "true") { collapseActionFab(b); Clico.setState(b, "idle"); }
    });
  }
  function attachDraggableFab(b, key) {
    if (b.dataset.dragReady) return;
    b.dataset.dragReady = "true";
    let gesture = null, clearSuppression = 0;
    const finish = async () => {
      if (!gesture) return;
      const dragged = gesture.dragged;
      try { if (b.hasPointerCapture(gesture.id)) b.releasePointerCapture(gesture.id); } catch {}
      gesture = null; b.dataset.dragging = "false";
      if (dragged) {
        b.dataset.suppressClick = "true";
        clearTimeout(clearSuppression);
        clearSuppression = setTimeout(() => { delete b.dataset.suppressClick; }, 500);
        await saveFabPosition(b, key);
      }
    };
    b.addEventListener("pointerdown", (e) => {
      if (run.busy || e.button !== 0 || !e.isPrimary) return;
      removeClicoIntroduction(b);
      collapseActionFab(b);
      Clico.setState(b, "idle");
      gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, right: parseFloat(b.style.right) || 0, bottom: parseFloat(b.style.bottom) || 0, dragged: false };
      try { b.setPointerCapture(e.pointerId); } catch {}
    });
    b.addEventListener("pointermove", (e) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (!gesture.dragged && Math.hypot(dx, dy) < 7) return;
      gesture.dragged = true; b.dataset.dragging = "true"; e.preventDefault();
      setFabAnchors(b, gesture.right - dx, gesture.bottom - dy);
    });
    b.addEventListener("pointerup", (e) => { if (gesture && e.pointerId === gesture.id) finish(); });
    b.addEventListener("pointercancel", finish);
    b.addEventListener("lostpointercapture", finish);
    b.addEventListener("click", (e) => {
      if (b.dataset.suppressClick === "true") { e.preventDefault(); e.stopImmediatePropagation(); delete b.dataset.suppressClick; }
    }, true);
  }

  function setApplyButton(b, profileName) {
    if (!b.querySelector(".pf-sp-apply-icon")) {
      b.innerHTML = '<span class="pf-sp-apply-copy" style="display:block;min-width:0;width:0;opacity:0;overflow:hidden;transition:opacity .15s ease,width .2s ease">' +
        '<span class="pf-sp-apply-title" style="display:block;white-space:nowrap;font-weight:700">&#9889; Apply prices + settings</span>' +
        '<span class="pf-sp-apply-profile" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d6f078;margin-top:2px"></span></span>' +
        Clico.markup("pf-sp-apply-icon");
      attachFabHover(b);
      Clico.setState(b, "idle");
    }
    if (!run.busy) {
      const copy = b.querySelector(".pf-sp-apply-copy"), title = b.querySelector(".pf-sp-apply-title");
      if (!b.matches(":hover") && b.dataset.dragging !== "true") {
        collapseActionFab(b);
        if (copy) { copy.style.width = "0"; copy.style.opacity = "0"; }
      }
      if (title) title.textContent = "⚡ Apply prices + settings";
    }
    const profile = b.querySelector(".pf-sp-apply-profile");
    if (profile) { profile.textContent = profileName || ""; profile.title = profileName || ""; }
  }

  function setEditorFab(b, count, profileName) {
    if (!b.querySelector(".pf-sp-editor-icon")) {
      b.innerHTML = '<span class="pf-sp-apply-copy" style="display:block;min-width:0;width:0;opacity:0;overflow:hidden;transition:opacity .15s ease,width .2s ease">' +
        '<span class="pf-sp-apply-title" style="display:block;white-space:nowrap;font-weight:700"></span>' +
        '<span class="pf-sp-apply-profile" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d6f078;margin-top:2px"></span></span>' +
        Clico.markup("pf-sp-editor-icon");
      attachFabHover(b);
      Clico.setState(b, "idle");
    }
    if (!run.busy && !b.matches(":hover") && b.dataset.dragging !== "true") collapseActionFab(b);
    const title = b.querySelector(".pf-sp-apply-title"), profile = b.querySelector(".pf-sp-apply-profile");
    if (title) title.textContent = `Select ${count} variants`;
    if (profile) { profile.textContent = profileName || ""; profile.title = profileName || ""; }
  }

  function actionFabProgress(b, text) {
    if (!b) return;
    const title = b.querySelector(".pf-sp-apply-title"), profile = b.querySelector(".pf-sp-apply-profile");
    Clico.setState(b, "working");
    expandActionFab(b);
    if (title) title.textContent = text + "  ·  ✕ stop";
    if (profile) profile.textContent = "";
  }
  function applyProgress(text) { actionFabProgress(document.getElementById("pf-sp-btn"), text); }

  // ---------- Multi-product listing: "Variation name for Etsy listing" ----------
  const onMultiPage = () => /\/app\/multi-product-listing/.test(location.pathname);
  const nameKey = (t) => norm(t).toLowerCase().replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();

  // Each listing item: its product name and its variation-name box
  function listingItems() {
    const labels = findText((t) => /^variation name for etsy listing$/i.test(t));
    const items = [];
    for (const lab of labels) {
      // the box that comes right after the label
      let input = null, n = lab;
      for (let i = 0; i < 6 && n && !input; i++, n = n.parentElement) {
        input = [...n.querySelectorAll("input, textarea")].find((e) =>
          !["checkbox", "radio", "hidden"].includes(e.type) && visible(e) &&
          (lab.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
      }
      if (!input) continue;
      // the item card: the largest box around the label that holds only this one label
      let card = lab;
      while (card.parentElement && card.parentElement !== document.body) {
        const up = card.parentElement;
        const count = [...up.querySelectorAll("*")].filter((e) => !e.children.length && /^variation name for etsy listing$/i.test(norm(e.textContent))).length;
        if (count > 1) break;
        card = up;
      }
      // product name: first link in the card, else the first text above the label
      const link = [...card.querySelectorAll("a")].find((a) => norm(a.textContent).length > 3 && !/edit details|how it works|see in store/i.test(a.textContent));
      let name = link ? norm(link.textContent) : "";
      if (!name) {
        const above = findText((t) => t.length > 3 && t.length < 90).filter((e) => card.contains(e) &&
          (e.compareDocumentPosition(lab) & Node.DOCUMENT_POSITION_FOLLOWING));
        name = above.length ? norm(above[0].textContent) : "";
      }
      items.push({ name, input, card });
    }
    return items;
  }

  function wantedFor(item, list) {
    const k = nameKey(item.name);
    const cardK = nameKey(item.card.textContent);
    // exact name first, then the longest saved name found inside the card
    return (list || []).find((r) => nameKey(r.from) === k) ||
      (list || []).filter((r) => r.from && cardK.includes(nameKey(r.from))).sort((a, b) => b.from.length - a.from.length)[0] || null;
  }

  async function typeInto(input, text) {
    await bringIntoView(input);
    const r = input.getBoundingClientRect();
    await cdp({ cdp: "click", x: Math.round(r.right - 14), y: Math.round(r.top + r.height / 2) });
    await waitFor(() => document.activeElement === input, 800, 50);
    if (document.activeElement !== input) input.focus();
    await cdp({ cdp: "insert", text });
    await sleep(120);
    await cdp({ cdp: "tab" });              // leaving the box saves it
    await sleep(250);
  }

  async function setVariationNames(list) {
    if (!onMultiPage()) throw new Error("Open a multi-product listing (Listing details tab) first.");
    const items = listingItems();
    if (!items.length) throw new Error('No "Variation name for Etsy listing" boxes found. Open the Listing details tab.');
    const plan = items.map((it) => ({ ...it, rule: wantedFor(it, list) }));
    const todo = plan.filter((p) => p.rule && p.input.value !== p.rule.to);
    const done = plan.filter((p) => p.rule && p.input.value === p.rule.to).map((p) => p.name);
    const notInList = plan.filter((p) => !p.rule).map((p) => p.name || "(unnamed item)");
    if (!todo.length) return { set: [], already: done, failed: [], notInList, total: items.length };

    await cdp({ cdp: "attach" });
    await sleep(350);
    const set = [], failed = [];
    let n = 0;
    for (const p of todo) {
      checkStop();
      progress(`Naming ${++n}/${todo.length}: ${p.rule.to}`);
      for (let attempt = 0; attempt < 3 && p.input.value !== p.rule.to; attempt++) {
        // The page may redraw after each save; find the same item's box again
        const fresh = listingItems().find((x) => x.name === p.name) || p;
        p.input = fresh.input;
        if (p.input.value === p.rule.to) break;
        await typeInto(p.input, p.rule.to);
      }
      (p.input.value === p.rule.to ? set : failed).push(p.name);
    }
    return { set, already: done, failed, notInList, total: items.length };
  }

  function nameSummary(r) {
    let msg = r.set.length ? `✓ Done. ${r.set.length} variation name${r.set.length === 1 ? "" : "s"} set.`
      : r.already.length ? `✓ Done. All ${r.already.length} names are already correct.` : "Nothing to set.";
    if (r.set.length && r.already.length) msg += ` ${r.already.length} already correct.`;
    if (r.failed.length) msg += ` Couldn't set: ${r.failed.join(", ")}. Try again.`;
    if (r.notInList.length) msg += ` Not in your list: ${r.notInList.join(", ")}.`;
    return msg + (r.set.length ? " Then click Save as draft or Publish." : "");
  }

  async function namesList() {
    // names belong to the product picked in ClickAway
    const d = await chrome.storage.local.get(["profiles", "activeId"]);
    const p = (d.profiles || []).find((x) => x.id === d.activeId);
    return Array.isArray(p?.varNames) ? p.varNames : [];
  }

  function addNamesButton() {
    if (document.getElementById("pf-sp-nbtn")) return;
    const b = document.createElement("button");
    b.id = "pf-sp-nbtn";
    Object.assign(b.style, {
      position: "fixed", right: "24px", bottom: "96px", zIndex: 2147483646,
    }, BTN_STYLE);
    b.addEventListener("click", async () => {
      try {
        const r = await runJob(b, async () => { progress("Starting"); return setVariationNames(await namesList()); });
        if (r) toast(nameSummary(r), !r.failed.length);
      } catch (e) { toast(e.message, false); }
    });
    document.body.appendChild(b);
    updateNamesLabel();
  }

  async function updateNamesLabel() {
    const b = document.getElementById("pf-sp-nbtn");
    if (!b || run.busy) return;
    const list = await namesList();
    const items = listingItems();
    const n = items.filter((it) => wantedFor(it, list)).length;
    // hide when nothing on this page is in your list
    b.style.display = n ? "flex" : "none";
    setBtn(b, "tag", `Set variation names (${n})`);
  }
  chrome.storage.onChanged.addListener(() => updateNamesLabel());

  // ---------- Toast + floating button ----------
  function clearToastPositioning(t) {
    t?._positionObserver?.disconnect();
    if (t) { delete t._positionObserver; delete t._clicoOwner; }
  }
  function dismissToast(t = document.getElementById("pf-sp-toast")) {
    if (!t) return;
    clearTimeout(t._h); clearTimeout(t._remove);
    clearToastPositioning(t);
    t.remove();
  }
  function dismissClicoBubble(owner) {
    const t = document.getElementById("pf-sp-toast");
    if (t?.dataset.presentation === "clico" && (!owner || t._clicoOwner === owner)) dismissToast(t);
  }
  function bubbleDuration(outcome) {
    return { success: 5500, cancelled: 4000, error: 5000, partial: 8000 }[outcome] || 5500;
  }
  function positionClicoBubble(owner) {
    const t = document.getElementById("pf-sp-toast");
    if (!t || t.dataset.presentation !== "clico" || t._clicoOwner !== owner || !owner.isConnected) return;
    const mascot = owner.querySelector(".pf-sp-clico") || owner;
    const artwork = mascot.querySelector("svg") || mascot;
    const artworkRect = artwork.getBoundingClientRect();
    const flame = mascot.querySelector(".pf-sp-clico-flame-outer");
    const character = mascot.querySelector(".pf-sp-clico-character");
    const flameRect = flame?.getBoundingClientRect();
    const characterRect = character?.getBoundingClientRect();
    const visibleFlameTop = flameRect?.height ? flameRect.top : artworkRect.top;
    const visibleCharacterBottom = characterRect?.height ? characterRect.bottom : artworkRect.bottom;
    const margin = 8, tailReach = 12, tailGap = 3;
    const bubbleWidth = t.offsetWidth, bubbleHeight = t.offsetHeight;
    const targetX = artworkRect.left + artworkRect.width / 2;
    const left = clamp(targetX - bubbleWidth / 2, margin, Math.max(margin, window.innerWidth - bubbleWidth - margin));
    // Use painted SVG path bounds: the SVG box includes transparent viewBox
    // space and misses transforms applied to Clico's animated character.
    const aboveTop = visibleFlameTop - tailGap - tailReach - bubbleHeight;
    const belowTop = visibleCharacterBottom + tailGap + tailReach;
    const fitsAbove = aboveTop >= margin;
    const fitsBelow = belowTop + bubbleHeight <= window.innerHeight - margin;
    const below = !fitsAbove && (fitsBelow || (window.innerHeight - belowTop > visibleFlameTop - margin));
    const availableHeight = below ? window.innerHeight - belowTop - margin : visibleFlameTop - tailGap - tailReach - margin;
    const needsHeightFallback = bubbleHeight > availableHeight;
    t.style.left = left + "px";
    t.style.top = Math.max(margin, below ? belowTop : aboveTop) + "px";
    t.style.maxHeight = needsHeightFallback ? Math.max(0, availableHeight) + "px" : "none";
    t.style.overflowY = needsHeightFallback ? "auto" : "visible";
    t.dataset.bubbleSide = below ? "below" : "above";
    const tail = t.querySelector(".pf-sp-toast-tail"), fill = t.querySelector(".pf-sp-toast-tail-fill");
    const tailLeft = clamp(targetX - left - 9, 12, Math.max(12, bubbleWidth - 30));
    if (tail && fill) {
      Object.assign(tail.style, below
        ? { left: tailLeft + "px", top: "-12px", bottom: "auto", clipPath: "polygon(50% 0, 0 100%, 100% 100%)" }
        : { left: tailLeft + "px", top: "auto", bottom: "-12px", clipPath: "polygon(0 0, 100% 0, 50% 100%)" });
      Object.assign(fill.style, below
        ? { left: tailLeft + 1 + "px", top: "-10px", bottom: "auto", clipPath: "polygon(50% 0, 0 100%, 100% 100%)" }
        : { left: tailLeft + 1 + "px", top: "auto", bottom: "-10px", clipPath: "polygon(0 0, 100% 0, 50% 100%)" });
    }
  }
  function scheduleToastDismiss(t, duration) {
    clearTimeout(t._h); clearTimeout(t._remove);
    t._h = setTimeout(() => {
      t.style.opacity = "0";
      t.style.pointerEvents = "none";
      t._remove = setTimeout(() => dismissToast(t), 300);
    }, duration);
  }
  function toast(text, ok = true, config) {
    let t = document.getElementById("pf-sp-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "pf-sp-toast";
      // General toasts remain clickable; Clico bubbles disable pointer events below.
      t.addEventListener("click", () => dismissToast(t));
      document.body.appendChild(t);
    }
    clearTimeout(t._h); clearTimeout(t._remove); clearToastPositioning(t);
    const isClicoBubble = config?.presentation === "clico" && config.owner?.isConnected;
    t.style.cssText = "";
    t.style.opacity = "1";
    if (!isClicoBubble) {
      delete t.dataset.presentation; delete t.dataset.bubbleSide;
      t.removeAttribute("role"); t.removeAttribute("aria-live");
      Object.assign(t.style, {
        position: "fixed", right: "24px", bottom: "150px", zIndex: 2147483647, maxWidth: "340px",
        padding: "12px 14px", borderRadius: "10px", font: "500 13px/1.45 system-ui, sans-serif",
        boxShadow: "0 6px 24px rgba(0,0,0,.25)", transition: "opacity .2s", cursor: "pointer",
        background: ok ? "#263428" : "#7a1f1f", color: "#fff"
      });
      t.title = "Click to close";
      t.textContent = text;
      placeOurs();
      scheduleToastDismiss(t, 7000);
      return;
    }
    t.dataset.presentation = "clico";
    t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite");
    t.removeAttribute("title");
    Object.assign(t.style, {
      position: "fixed", zIndex: 2147483647, width: "max-content", maxWidth: "min(320px, calc(100vw - 16px))",
      padding: "16px 20px", border: "none", borderRadius: "38px",
      background: "#263428", color: "#FFFFFF", font: "600 12px/1.45 system-ui, sans-serif",
      boxShadow: "0 4px 14px rgba(20,36,24,.22)", pointerEvents: "none", transition: matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "opacity .16s ease",
      overflowWrap: "anywhere"
    });
    const body = document.createElement("span");
    const label = document.createElement("span");
    label.textContent = "CLICO SAYS";
    label.setAttribute("aria-hidden", "true");
    Object.assign(label.style, { display: "block", marginBottom: "3px", color: "#B9E66F", fontSize: "10px", fontWeight: "700", letterSpacing: ".8px", lineHeight: "1.15" });
    const message = document.createElement("span");
    message.textContent = text;
    body.append(label, message);
    const tail = document.createElement("span"), fill = document.createElement("span");
    tail.className = "pf-sp-toast-tail"; fill.className = "pf-sp-toast-tail-fill";
    Object.assign(tail.style, { position: "absolute", width: "18px", height: "14px", background: "#263428", pointerEvents: "none" });
    Object.assign(fill.style, { display: "none", background: "#263428", pointerEvents: "none" });
    t.replaceChildren(body, tail, fill);
    t._clicoOwner = config.owner;
    t._positionObserver = new ResizeObserver(() => positionClicoBubble(config.owner));
    t._positionObserver.observe(config.owner);
    const mascot = config.owner.querySelector(".pf-sp-clico");
    if (mascot) t._positionObserver.observe(mascot);
    positionClicoBubble(config.owner);
    scheduleToastDismiss(t, bubbleDuration(config.outcome));
  }
  function clicoOutcomeToast(owner, text, outcome) {
    removeAllClicoIntroductions();
    toast(text, outcome !== "error", { presentation: "clico", owner, outcome });
  }
  function clicoFailureOutcome(error) {
    // Keep the same cancellation contract used by ClickAwayClico.failure().
    return /^Stopped\b/.test(error?.message || "") ? "cancelled" : "error";
  }

  async function activeProfile() {
    const d = await chrome.storage.local.get(["profiles", "activeId", "prices"]);
    const p = (d.profiles || []).find((x) => x.id === d.activeId) || (d.profiles || [])[0];
    return p || { name: "", prices: d.prices || {}, sizes: null, colors: [] };
  }

  // Safety: only use a product's prices/variants on a page that is linked to it
  // (or where you picked that product by hand in the popup).
  async function linkCheck() {
    const d = await chrome.storage.local.get(["profiles", "activeId", "pinned"]);
    const act = (d.profiles || []).find((p) => p.id === d.activeId);
    if (!act) return { ok: false, msg: "No product selected. Add or pick a product in ClickAway first." };
    if (d.pinned && d.pinned.path === location.pathname && d.pinned.id === act.id) return { ok: true, act };
    const m = bestMatch(d.profiles, pageNames());
    if (m && m.id === act.id) return { ok: true, act };
    if (m) return { ok: false, msg: `This page belongs to "${m.name}", not "${act.name}". Nothing was changed.` };
    return { ok: false, msg: `This page isn't linked to "${act.name}". Open ClickAway and click "Link This Page", then try again. Nothing was changed.` };
  }
  async function mustBeLinked() {
    const c = await linkCheck();
    if (!c.ok) throw new Error(c.msg);
    return c.act;
  }

  let runFromStorage = async function () {
    const p = await activeProfile();
    return applyPrices(p.prices, p.sizes);
  };

  const visibleOne = (selector, label) => {
    const matches = [...document.querySelectorAll(selector)].filter(visible);
    if (matches.length !== 1) throw new Error(`${label}: expected one visible control, found ${matches.length}. Nothing was changed.`);
    return matches[0];
  };

  async function activateTab(selector, label) {
    checkStop();
    const tab = visibleOne(selector, label);
    if (tab.getAttribute("aria-selected") !== "true") {
      const r = tab.getBoundingClientRect();
      await cdp({ cdp: "click", x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    }
    checkStop();
    if (!await waitFor(() => visibleOne(selector, label).getAttribute("aria-selected") === "true", 4000))
      throw new Error(`${label} did not become active. Nothing else was changed.`);
  }

  async function openDetailedPricing() {
    progress("Opening Pricing");
    await activateTab('button[role="tab"][data-testid="navTab-pd-pricing"]', "Pricing tab");
    checkStop();
    const tableTab = visibleOne('button#tab-label-table[role="tab"]', "Detailed table view");
    if (tableTab.getAttribute("aria-selected") !== "true") {
      const r = tableTab.getBoundingClientRect();
      await cdp({ cdp: "click", x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    }
    checkStop();
    if (!await waitFor(() => visibleOne('button#tab-label-table[role="tab"]', "Detailed table view").getAttribute("aria-selected") === "true" &&
      document.querySelector('#tab-panel-table[role="tabpanel"]')?.getAttribute("aria-hidden") === "false" && !!getColumns().retail, 5000))
      throw new Error("Detailed pricing table did not finish loading. Nothing else was changed.");
  }

  function publishingControl(role, testId, label, prefix = false) {
    const expected = norm(label).toLowerCase();
    const matches = [...document.querySelectorAll(`div[role="${role}"][data-testid="${testId}"]`)]
      .filter(visible)
      .filter((el) => {
        // Printify's checkbox icon contributes a leading "check" text node.
        // Strip only that verified decoration before comparing the visible label.
        let text = norm(el.textContent).toLowerCase();
        if (role === "checkbox") text = text.replace(/^check\s+/, "");
        return prefix ? text.startsWith(expected) : text === expected;
      });
    if (matches.length !== 1) throw new Error(`${label}: expected one visible Publishing control, found ${matches.length}.`);
    const wrapper = matches[0];
    const input = wrapper.querySelector(`input[type="${role === "checkbox" ? "checkbox" : "radio"}"]`);
    if (!input) throw new Error(`${label}: native input was not found.`);
    return { wrapper, input };
  }

  function controlState(control, label) {
    const aria = control.wrapper.getAttribute("aria-checked");
    if (aria !== "true" && aria !== "false") throw new Error(`${label}: state is unavailable.`);
    if ((aria === "true") !== control.input.checked) throw new Error(`${label}: wrapper and input state disagree.`);
    return aria === "true";
  }

  async function settleControlPosition(el) {
    let previous = "";
    for (let i = 0; i < 12; i++) {
      checkStop();
      await sleep(30);
      const r = el.getBoundingClientRect();
      const current = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (current === previous) return;
      previous = current;
    }
  }

  async function safeRadioPoint(testId, label, prefix) {
    // A sticky Printify header can cover a valid radio after a center scroll. Try
    // several layout-derived placements and accept only an unobstructed radio hit.
    for (const block of ["end", "start", "center", "nearest"]) {
      checkStop();
      let control = publishingControl("radio", testId, label, prefix);
      control.wrapper.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
      await settleControlPosition(control.wrapper);
      control = publishingControl("radio", testId, label, prefix); // Printify may re-render while scrolling.
      const circle = control.wrapper.querySelector(".radio-radio");
      const container = control.wrapper.querySelector(".radio-container");
      if (!circle || !container) continue;
      const r = circle.getBoundingClientRect();
      const point = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      const inViewport = r.width > 0 && r.height > 0 && point.x >= 0 && point.y >= 0 &&
        point.x < window.innerWidth && point.y < window.innerHeight;
      if (!inViewport) continue;
      const top = document.elementsFromPoint(point.x, point.y)[0];
      const onRadio = top && (top === circle || circle.contains(top) || top === container || container.contains(top));
      if (onRadio) return { control, point };
    }
    throw new Error(`${label}: no unobstructed radio click point is available.`);
  }

  function checkboxSquare(wrapper) {
    const row = wrapper.getBoundingClientRect();
    return [...wrapper.querySelectorAll("*")]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width >= 10 && r.width <= 44 && r.height >= 10 && r.height <= 44 &&
        Math.abs(r.width - r.height) <= 3 && r.left >= row.left - 1 && r.right <= Math.min(row.right, row.left + 88) &&
        r.top <= row.bottom && r.bottom >= row.top)
      .sort((a, b) => a.r.left - b.r.left || Math.abs(a.r.width - 24) - Math.abs(b.r.width - 24))[0]?.el || null;
  }

  async function safeCheckboxPoint(testId, label, prefix) {
    // The checkbox input may be visually hidden. Identify its visible square only
    // after the row settles, then require hit-testing to prove it is unobstructed.
    for (const block of ["end", "start", "center", "nearest"]) {
      checkStop();
      let control = publishingControl("checkbox", testId, label, prefix);
      control.wrapper.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
      await settleControlPosition(control.wrapper);
      control = publishingControl("checkbox", testId, label, prefix); // Printify may re-render while scrolling.
      const square = checkboxSquare(control.wrapper);
      if (!square) continue;
      const r = square.getBoundingClientRect();
      const point = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      const inViewport = point.x >= 0 && point.y >= 0 && point.x < window.innerWidth && point.y < window.innerHeight;
      if (!inViewport) continue;
      const top = document.elementsFromPoint(point.x, point.y)[0];
      if (top && (top === square || square.contains(top) || control.wrapper.contains(top))) return { control, point };
    }
    throw new Error(`${label}: no unobstructed checkbox click point is available.`);
  }

  async function ensurePublishingControl(role, testId, label, prefix = false) {
    checkStop();
    let control = publishingControl(role, testId, label, prefix);
    if (controlState(control, label)) return "already enabled";
    let point;
    if (role === "radio") {
      const safe = await safeRadioPoint(testId, label, prefix);
      control = safe.control;
      if (controlState(control, label)) return "already enabled";
      point = safe.point;
    } else if (role === "checkbox") {
      const safe = await safeCheckboxPoint(testId, label, prefix);
      control = safe.control;
      if (controlState(control, label)) return "already enabled";
      point = safe.point;
    } else {
      const r = control.wrapper.getBoundingClientRect();
      point = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    checkStop();
    await cdp({ cdp: "click", ...point });
    checkStop();
    const changed = await waitFor(() => {
      control = publishingControl(role, testId, label, prefix);
      return controlState(control, label);
    }, 4000);
    if (!changed) throw new Error(`${label} did not update or could not be verified.`);
    return "enabled";
  }

  async function applyPricesAndPublishing() {
    await autoSelect(true).catch(() => {});
    const profile = await mustBeLinked();
    checkStop();
    await openDetailedPricing();
    checkStop();
    progress("Applying prices");
    const prices = await applyPrices(profile.prices, profile.sizes);
    if (prices.failed.length) throw new Error(`Prices were not fully applied: ${prices.failed.join("; ")}. Publishing settings were not changed.`);
    checkStop();
    progress("Opening Publishing settings");
    await activateTab('button[role="tab"][data-testid="navTab-pd-publishing-settings"]', "Publishing settings tab");
    checkStop();
    if (!await waitFor(() => {
      try {
        publishingControl("checkbox", "checkboxWrapper", "Hide in store");
        publishingControl("radio", "radioWrapper", "Show all variants as available for purchase", true);
        return true;
      } catch { return false; }
    }, 5000)) throw new Error("Prices were applied, but Publishing controls could not be uniquely identified. No Publishing settings were changed.");
    progress("Updating Hide in store");
    let hide;
    try { hide = await ensurePublishingControl("checkbox", "checkboxWrapper", "Hide in store"); }
    catch (e) {
      if (run.stop) throw e;
      throw new Error(`Prices were applied. Hide in store could not be updated or verified: ${e.message} Variant visibility was not changed.`);
    }
    checkStop();
    progress("Updating variant visibility");
    let variants;
    try { variants = await ensurePublishingControl("radio", "radioWrapper", "Show all variants as available for purchase", true); }
    catch (e) {
      if (run.stop) throw e;
      throw new Error(`Prices were applied. Hide in store ${hide}. Variant visibility could not be updated or verified: ${e.message}`);
    }
    return { prices, hide, variants };
  }

  async function updateButtonLabel() {
    const p = await activeProfile();
    if (run.busy) return;
    const linked = (await linkCheck().catch(() => ({ ok: false }))).ok;
    const b = document.getElementById("pf-sp-btn");
    // No product (or nothing saved for this job): hide the button instead of showing "0"
    if (b) b.style.display = linked && p.name && Object.keys(p.prices || {}).length ? "flex" : "none";
    if (b && !b.disabled) { setApplyButton(b, p.name); b.title = p.name; }
    const c = document.getElementById("pf-sp-cbtn");
    if (c) c.style.display = linked && p.name && (p.colors || []).some((x) => !(p.held || []).some((h) => h.toUpperCase() === x.toUpperCase())) ? "flex" : "none";
    if (c && !c.disabled) {
      const heldU = (p.held || []).map((h) => h.toUpperCase());
      const n = (p.colors || []).filter((x) => !heldU.includes(x.toUpperCase())).length;
      setEditorFab(c, n, p.name);
      c.title = (p.colors || []).filter((x) => !heldU.includes(x.toUpperCase())).join(", ");
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[FAB_POSITIONS_KEY]) {
      fabPositions = changes[FAB_POSITIONS_KEY].newValue || {};
      clampVisibleFabs();
      placeOurs();
    }
    updateButtonLabel();
  });

  function addButton() {
    if (document.getElementById("pf-sp-btn")) return;
    const b = document.createElement("button");
    b.id = "pf-sp-btn";
    setApplyButton(b, "");
    Object.assign(b.style, APPLY_BTN_STYLE);
    attachDraggableFab(b, "pricing");
    b.addEventListener("click", async () => {
      try {
        const r = await runJob(b, () => { progress("Starting"); return applyPricesAndPublishing(); });
        if (r) { Clico.success(b); clicoOutcomeToast(b, `Prices applied. Hide in store ${r.hide}; show all variants ${r.variants}. Settings are updated in the current form.`, "success"); }
      } catch (e) { Clico.failure(b, e); clicoOutcomeToast(b, e.message, clicoFailureOutcome(e)); }
    });
    document.body.appendChild(b);
    restoreFabPosition(b, "pricing");
    updateButtonLabel();
  }

  // ---------- Product auto-select ----------
  const GENERIC = /^(printify|pricing|mockups|selected mockups|listing details|personalization|shipping|publishing settings|preview|listing health|product visibility|important info.*|free shipping|etsy off-site ads|back to my products|my products|quick overview|detailed table view)$/i;

  // Names on the page that describe the product (e.g. "Unisex Garment-Dyed T-shirt")
  let namesCache = { path: "", at: 0, names: [] };
  function pageNames(fresh = false) {
    const c = namesCache;
    if (!fresh && c.path === location.pathname && c.names.length && Date.now() - c.at < 4000) return c.names;
    const out = [];
    const add = (t) => { t = norm(t); if (t && t.length >= 3 && t.length <= 90 && !GENERIC.test(t) && !out.includes(t)) out.push(t); };
    const title = norm(document.title.split("|")[0]);
    if (!/printify/i.test(title)) add(title);
    document.querySelectorAll("h1, h2, h3").forEach((e) => add(e.textContent));
    // big text (22px+) is usually the product name
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let checked = 0;
    for (let n = walker.nextNode(); n && checked < 2500; n = walker.nextNode()) {
      const v = n.nodeValue && n.nodeValue.trim();
      if (!v || v.length < 3 || v.length > 90) continue;
      const e = n.parentElement;
      if (!e || seen.has(e) || e.childElementCount) continue;
      seen.add(e); checked++;
      if (parseFloat(getComputedStyle(e).fontSize) >= 22 && visible(e)) add(e.textContent);
    }
    namesCache = { path: location.pathname, at: Date.now(), names: out };
    return out;
  }


  function bestMatch(profiles, names) {
    const hay = names.join(" \n ").toLowerCase();
    let best = null, score = 0;
    for (const p of profiles || []) for (const l of p.links || []) {
      const k = norm(l).toLowerCase();
      if (k && hay.includes(k) && k.length > score) { best = p; score = k.length; }
    }
    return best;
  }

  let lastAutoKey = "";
  async function autoSelect(force = false) {
    const d = await chrome.storage.local.get(["profiles", "activeId", "pinned"]);
    // You picked a product by hand on this page: keep your choice
    if (d.pinned && d.pinned.path === location.pathname && (d.profiles || []).some((p) => p.id === d.pinned.id)) {
      if (d.activeId !== d.pinned.id) await chrome.storage.local.set({ activeId: d.pinned.id });
      return null;
    }
    const names = pageNames(force);
    const m = bestMatch(d.profiles, names);
    const key = location.pathname + "|" + (m ? m.id : "");
    if (!m) { lastAutoKey = key; return null; }
    if (m.id !== d.activeId && (force || key !== lastAutoKey)) {
      await chrome.storage.local.set({ activeId: m.id, prices: m.prices || {} });
      toast(`Switched to "${m.name}" for this product.`);
    }
    lastAutoKey = key;
    return m;
  }

  // Updates run only when the page or route changes (not every second), at most about once a second
  let lastPath = null, routeAt = 0, refreshT = 0, lastRefresh = 0;
  function cleanupDead() {
    clearInterval(window.__pfSP.timer);
    window.__pfSP.obs?.disconnect();
    dismissClicoBubble();
    ["pf-sp-btn", "pf-sp-cbtn", "pf-sp-nbtn"].forEach((id) => {
      const button = document.getElementById(id);
      removeClicoIntroduction(button);
      Clico.cleanup(button);
      button?.remove();
    });
  }
  function scheduleRefresh(delay = 600) {
    if (refreshT) return;
    const wait = Math.max(delay, 1000 - (Date.now() - lastRefresh));
    refreshT = setTimeout(() => { refreshT = 0; refresh(); }, wait);
  }
  async function refresh() {
    if (!window.__pfSP.alive()) return cleanupDead();
    if (run.busy) return;
    lastRefresh = Date.now();
    const path = location.pathname;
    const onProduct = /product-details|products\/.+|\/app\/editor\//.test(path);
    const onEditPage = /\/app\/product-details\//.test(path);   // pricing table lives here
    const onEditor = /\/app\/editor\//.test(path);
    if (onEditPage) addButton(); else { const b = document.getElementById("pf-sp-btn"); dismissClicoBubble(b); removeClicoIntroduction(b); Clico.cleanup(b); b?.remove(); }
    if (onEditor) { addColorButton(); placeOurs(); } else { const b = document.getElementById("pf-sp-cbtn"); dismissClicoBubble(b); removeClicoIntroduction(b); Clico.cleanup(b); b?.remove(); }
    if (onMultiPage()) { addNamesButton(); updateNamesLabel(); } else document.getElementById("pf-sp-nbtn")?.remove();
    if (!onProduct) return;
    // the product name loads a bit after the page; keep looking for it for a while
    if (Date.now() - routeAt < 15000) await autoSelect().catch(() => {});
    updateButtonLabel();
  }
  const ours = (n) => n && n.nodeType === 1 ? !!n.closest?.("[id^='pf-sp-']") : !!n?.parentElement?.closest?.("[id^='pf-sp-']");
  // Only react when page elements are added or removed (new content), not to ticking text like timers
  const structural = (r) => !ours(r.target) &&
    [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && !ours(n));
  window.__pfSP.obs = new MutationObserver((recs) => {
    if (run.busy || refreshT) return;
    if (recs.some(structural)) scheduleRefresh(700);
  });
  window.__pfSP.obs.observe(document.body, { childList: true, subtree: true });
  let tick = 0;
  window.__pfSP.timer = setInterval(() => {
    if (!window.__pfSP.alive()) return cleanupDead();
    if (++tick % 4 === 0 && Date.now() - routeAt < 15000) scheduleRefresh(0);
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      routeAt = Date.now();
      namesCache = { path: "", at: 0, names: [] };
      if (!run.busy) dismissToast();
      clearTimeout(refreshT); refreshT = 0;
      scheduleRefresh(150);
    }
  }, 500);

  // Before applying, make sure the right product is selected
  const _runFromStorage = runFromStorage;
  runFromStorage = async function () { await autoSelect(true).catch(() => {}); await mustBeLinked(); return _runFromStorage(); };

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === "PF_COLORS") {
      if (run.busy) { reply({ ok: false, message: "Already working. Wait for it to finish." }); return; }
      runJob(document.getElementById("pf-sp-cbtn"), async () => { await autoSelect(true).catch(() => {}); await mustBeLinked(); return selectColors(msg.colors); })
        .then((r) => { const button = document.getElementById("pf-sp-cbtn"), ok = r.done.length > 0, m = colorSummary(r, msg.label); Clico.outcome(button, ok); clicoOutcomeToast(button, m, ok ? (r.missing.length ? "partial" : "success") : "error"); reply({ ok, message: m }); })
        .catch(async (e) => { try { await cdp({ cdp: "detach" }); } catch {} const button = document.getElementById("pf-sp-cbtn"); Clico.failure(button, e); clicoOutcomeToast(button, e.message, clicoFailureOutcome(e)); reply({ ok: false, message: e.message }); });
      return true;
    }
    if (msg?.type === "PF_NAMES_READ") {
      reply({ ok: onMultiPage(), items: onMultiPage() ? listingItems().map((it) => ({ name: it.name, value: it.input.value })) : [] });
      return;
    }
    if (msg?.type === "PF_NAMES_SET") {
      if (run.busy) { reply({ ok: false, message: "Already working. Wait for it to finish." }); return; }
      runJob(document.getElementById("pf-sp-nbtn"), () => setVariationNames(msg.list))
        .then((r) => { const m = nameSummary(r); toast(m, !r.failed.length); reply({ ok: !r.failed.length, message: m }); })
        .catch((e) => { toast(e.message, false); reply({ ok: false, message: e.message }); });
      return true;
    }
    if (msg?.type === "PF_PAGE") {
      chrome.storage.local.get(["profiles"]).then((d) => {
        const names = pageNames();
        const m = bestMatch(d.profiles, names);
        reply({ ok: true, names, matchId: m ? m.id : null });
      });
      return true;
    }
    if (msg?.type === "PF_APPLY") {
      if (run.busy) { reply({ ok: false, message: "Already working. Wait for it to finish." }); return; }
      runJob(document.getElementById("pf-sp-btn"), async () => { await autoSelect(true).catch(() => {}); await mustBeLinked(); return applyPrices(msg.prices, msg.sizes); })
        .then((res) => { const button = document.getElementById("pf-sp-btn"), ok = !res.failed.length, m = summary(res); Clico.outcome(button, ok); clicoOutcomeToast(button, m, ok ? "success" : "partial"); reply({ ok: true, message: m }); })
        .catch((e) => { const button = document.getElementById("pf-sp-btn"); Clico.failure(button, e); clicoOutcomeToast(button, e.message, clicoFailureOutcome(e)); reply({ ok: false, message: e.message }); });
      return true;
    }
  });
})();
