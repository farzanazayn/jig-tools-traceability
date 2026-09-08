// =====================================================
// Jig & Tools Maintenance Traceability System — app.js
// =====================================================

let allRequests = [];
let allLots = [];
let currentReturnRecord = null;
let currentApproveRecord = null;
let currentUpdateLot = null;
let currentLotHistory = null;

function imageUrl(jigToolId, hasImage) {
  return hasImage ? `${API}/api/jigs/${jigToolId}/image` : null;
}

function thumbHtml(lot) {
  const url = imageUrl(lot.jig_tool_id, lot.has_image);
  if (!url) return `<div class="jig-thumb-placeholder">&#128736;&#65039;</div>`;
  return `<img class="jig-thumb" src="${url}" alt="${lot.jig_tool_name}" data-lightbox="${url}" />`;
}

function openLightbox(url) {
  const lb = document.getElementById("lightbox");
  document.getElementById("lightbox-img").src = url;
  lb.classList.add("open");
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-lightbox]");
  if (t) { openLightbox(t.dataset.lightbox); return; }
  if (e.target.id === "lightbox") document.getElementById("lightbox").classList.remove("open");
});

// ── Sidebar toggle ──────────────────────────────────
(function initSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const btn = document.getElementById("btn-sidebar-toggle");
  if (btn && sidebar) {
    btn.addEventListener("click", () => sidebar.classList.toggle("collapsed"));
  }
})();

// ── Live clock ──────────────────────────────────────
function updateClock() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const str = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const cl = document.getElementById("live-clock");
  if (cl) cl.textContent = str;
  const rc = document.getElementById("req-clock");
  if (rc) rc.value = str;
}
updateClock();
setInterval(updateClock, 1000);

// ── Panel navigation ──────────────────────────────
function activatePanel(panelKey) {
  document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  const item = document.querySelector(`.sidebar-item[data-panel="${panelKey}"]`);
  if (item) item.classList.add("active");
  document.getElementById(`panel-${panelKey}`).classList.add("active");
  if (panelKey === "update-packages") loadUpdatePackages();
  if (panelKey === "register") loadPackagesForRegister();
  if (panelKey === "queued") renderQueuedList();
  if (panelKey === "request") openRequestPage();
  if (panelKey === "lot-history") {
    document.getElementById("lh-search").value = "";
    document.getElementById("lh-detail").style.display = "none";
    document.getElementById("btn-export-excel").style.display = "none";
    setDeptSectionExpanded("t2");
    renderStockHistoryList();
  }
}

document.querySelectorAll(".sidebar-item[data-panel]").forEach(item => {
  item.addEventListener("click", () => {
    if (item.classList.contains("admin-only") && !isAdmin()) return;
    activatePanel(item.dataset.panel);
  });
});

// =====================================================
// LOAD DATA
// =====================================================
async function loadAllRequests() {
  try {
    allRequests = await apiGet("/api/request");
    renderBorrowedList();
    renderQueuedList();
    updateStats();
  } catch (err) { console.error("loadAllRequests:", err); }
}

async function loadAllLots() {
  try {
    allLots = await apiGet("/api/lots");
    populateMachineFilterOptions();
  } catch (err) { console.error("loadAllLots:", err); }
}

function populateMachineFilterOptions() {
  const machines = [...new Set(allLots.map(l => l.machine).filter(Boolean))].sort();
  for (const selectId of ["lh-machine-filter", "pkg-machine-filter"]) {
    const sel = document.getElementById(selectId);
    if (!sel) continue;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Machines</option>' +
      machines.map(m => `<option value="${m}">${m}</option>`).join("");
    if (machines.includes(current)) sel.value = current;
  }
}

function refreshAll() {
  loadAllRequests();
  loadAllLots();
}

// =====================================================
// STATUS HELPERS
// =====================================================
function getDisplayStatus(r) {
  if (r.status === "pending") return "pending";
  if (r.status === "rejected") return "rejected";
  if (r.status === "returned") return "returned";
  if (r.status === "borrowed") return isOverdue(r.borrow_datetime) ? "overdue" : "active";
  return r.status;
}

function statusBadge(status) {
  const map = {
    pending:  ["badge-pending",  "Pending"],
    active:   ["badge-active",   "Active"],
    overdue:  ["badge-overdue",  "Overdue"],
    rejected: ["badge-rejected", "Rejected"],
    returned: ["badge-returned", "Returned"],
  };
  const [cls, label] = map[status] || ["badge-returned", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function actionBadge(type) {
  const map = {
    OUT: "action-out", IN: "action-in",
    QTY_UPDATE: "action-update",
    LOCATION_CHANGE: "action-update", REGISTERED: "action-reg",
    LOT_NUMBER_CHANGE: "action-update",
  };
  return `<span class="${map[type] || 'action-reg'}">${type}</span>`;
}

// =====================================================
// STATS
// =====================================================
function updateStats() {
  const pending = allRequests.filter(r => r.status === "pending").length;
  const active  = allRequests.filter(r => getDisplayStatus(r) === "active").length;
  const overdue = allRequests.filter(r => getDisplayStatus(r) === "overdue").length;
  document.getElementById("stat-pending").textContent = pending;
  document.getElementById("stat-active").textContent  = active;
  document.getElementById("stat-overdue").textContent = overdue;
  document.getElementById("pending-count").textContent = pending;
}

// =====================================================
// BORROWED LIST
// =====================================================
function renderBorrowedList() {
  const tbody = document.getElementById("borrowed-tbody");
  const empty = document.getElementById("borrowed-empty");
  const search = document.getElementById("search-box").value.toLowerCase();
  const deptFilter = document.getElementById("dept-filter").value;

  let rows = allRequests.filter(r => {
    const status = getDisplayStatus(r);
    if (status === "returned" || status === "rejected") return false;
    if (deptFilter && r.department !== deptFilter) return false;
    if (search) {
      const hay = `${r.request_number} ${r.handler_no} ${r.technician_name} ${r.jig_tool_name}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  tbody.innerHTML = "";
  if (rows.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  for (const r of rows) {
    const status = getDisplayStatus(r);
    const showReturn = status === "active" || status === "overdue";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${thumbHtml(r)}</td>
      <td><span class="reqno" data-id="${r.borrow_id}" style="cursor:pointer;">${r.request_number}</span></td>
      <td><span class="lot-tag" data-lot="${r.lot_number}" style="cursor:pointer;">${r.jig_tool_name}</span></td>
      <td>${r.department}</td>
      <td>${r.rack_location}</td>
      <td>${r.handler_no}</td>
      <td>${r.technician_name}</td>
      <td>${r.requested_qty}</td>
      <td>${r.purpose}</td>
      <td>${formatDateTime(r.borrow_datetime)}</td>
      <td>${showReturn ? formatDuration(r.borrow_datetime) : "—"}</td>
      <td>${showReturn ? `<span class="badge ${status === "overdue" ? "badge-overdue" : "badge-active"}">Out</span>` : statusBadge(status)}</td>
      <td>${showReturn ? `<button class="btn-return-row" data-id="${r.borrow_id}">Return</button>` : ""}</td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".reqno[data-id]").forEach(el => {
    el.addEventListener("click", () => openReqDetail(Number(el.dataset.id)));
  });
  tbody.querySelectorAll(".lot-tag[data-lot]").forEach(el => {
    el.addEventListener("click", () => openLotHistoryPanel(el.dataset.lot));
  });
  tbody.querySelectorAll(".btn-return-row[data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = allRequests.find(x => x.borrow_id === Number(btn.dataset.id));
      if (r) openReturnPopup(r);
    });
  });
}

document.getElementById("search-box").addEventListener("input", renderBorrowedList);
document.getElementById("dept-filter").addEventListener("change", renderBorrowedList);

// =====================================================
// QUEUED LIST
// =====================================================
function renderQueuedList() {
  renderQueuedSection("Test 2", "queued-t2-tbody", "queued-t2-empty", "q2-action-col");
  renderQueuedSection("Test 1", "queued-t1-tbody", "queued-t1-empty", "q1-action-col");
}

function renderQueuedSection(dept, tbodyId, emptyId, headerId) {
  const tbody = document.getElementById(tbodyId);
  const empty = document.getElementById(emptyId);
  const header = document.getElementById(headerId);
  if (!tbody) return;
  if (header) header.textContent = isAdmin() ? "Action" : "";

  const rows = allRequests.filter(r => r.department === dept);
  tbody.innerHTML = "";
  if (rows.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  for (const r of rows) {
    const status = getDisplayStatus(r);
    const showReview = isAdmin() && r.status === "pending";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="reqno">${r.request_number}</span></td>
      <td>${r.jig_tool_name}</td>
      <td>${r.handler_no}</td>
      <td>${r.technician_name}</td>
      <td>${r.requested_qty}</td>
      <td>${r.purpose}</td>
      <td>${formatDateTime(r.borrow_datetime)}</td>
      <td>${statusBadge(status)}</td>
      <td>${showReview ? `<button class="btn btn-sm" data-id="${r.borrow_id}">Review</button>` : ""}</td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", () => openApprovePopup(Number(btn.dataset.id)));
  });
}

// =====================================================
// ADMIN LOGIN
// =====================================================
document.getElementById("btn-admin-login").addEventListener("click", () => {
  if (isAdmin()) {
    clearAdmin();
    renderBorrowedList();
    renderQueuedList();
    document.querySelector('.sidebar-item[data-panel="main"]').click();
  } else {
    openPopup("modal-login");
  }
});

document.getElementById("btn-do-login").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const msg = document.getElementById("login-msg");
  hideMsg(msg);
  if (!username || !password) { showMsg(msg, "Please enter username and password.", "error"); return; }
  try {
    const admin = await apiPost("/api/auth/login", { username, password });
    setAdmin(admin);
    closePopup("modal-login");
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    renderBorrowedList();
    renderQueuedList();
  } catch (err) {
    showMsg(msg, err.message, "error");
  }
});

// =====================================================
// REQUEST POPUP
// =====================================================
document.getElementById("btn-open-request").addEventListener("click", () => activatePanel("request"));

function openRequestPage() {
  clearRequestForm();
  // Refresh lot/qty data in the background so the page shows instantly instead of
  // waiting on a network round-trip before it can even render.
  loadAllLots().then(() => {
    const dept = document.getElementById("req-dept").value;
    if (dept) document.getElementById("req-dept").dispatchEvent(new Event("change"));
  });
}

function renderJigLotPicker(lots) {
  const list = document.getElementById("req-lot-list");
  if (lots.length === 0) {
    list.innerHTML = `<div class="jig-picker-empty">No jigs/tools available in this department.</div>`;
    return;
  }
  list.innerHTML = lots.map(l => {
    const url = imageUrl(l.jig_tool_id, l.has_image);
    const thumb = url
      ? `<img class="jig-picker-row-thumb jig-thumb" src="${url}" alt="${l.jig_tool_name}" />`
      : `<div class="jig-picker-row-thumb jig-thumb-placeholder">&#128736;&#65039;</div>`;
    return `
      <div class="jig-picker-row" data-lot-id="${l.lot_id}">
        ${thumb}
        <div class="jig-picker-row-text">
          <div class="jig-picker-row-name">${l.jig_tool_name}</div>
          <div class="jig-picker-row-meta">${l.rack_location} · Avail: ${l.current_qty}</div>
        </div>
      </div>
    `;
  }).join("");
  list.querySelectorAll(".jig-picker-row[data-lot-id]").forEach(row => {
    row.addEventListener("click", () => selectJigLot(Number(row.dataset.lotId)));
  });
}

document.getElementById("req-lot-toggle").addEventListener("click", () => {
  const picker = document.getElementById("req-lot-picker");
  if (document.getElementById("req-lot-toggle").disabled) return;
  picker.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  const picker = document.getElementById("req-lot-picker");
  if (picker && !picker.contains(e.target)) picker.classList.remove("open");
});

document.getElementById("req-dept").addEventListener("change", () => {
  const dept = document.getElementById("req-dept").value;
  const toggle = document.getElementById("req-lot-toggle");
  const picker = document.getElementById("req-lot-picker");
  document.getElementById("req-lot").value = "";
  document.getElementById("req-image-preview").style.display = "none";
  picker.classList.remove("open");
  toggle.disabled = !dept;
  toggle.querySelector(".jig-picker-toggle-thumb").outerHTML = `<span class="jig-picker-toggle-thumb jig-thumb-placeholder">&#128736;&#65039;</span>`;
  toggle.querySelector(".jig-picker-toggle-label").textContent = dept ? "-- Select jig / tool --" : "-- Select department first --";
  document.getElementById("req-location").value = "";
  document.getElementById("req-available").value = "";
  if (!dept) { renderJigLotPicker([]); return; }
  const filtered = allLots.filter(l => l.department === dept && l.current_qty > 0);
  renderJigLotPicker(filtered);
});

function selectJigLot(lotId) {
  const lot = allLots.find(l => l.lot_id === lotId);
  if (!lot) return;
  document.getElementById("req-lot").value = lotId;
  document.getElementById("req-lot-picker").classList.remove("open");

  const toggle = document.getElementById("req-lot-toggle");
  const url = imageUrl(lot.jig_tool_id, lot.has_image);
  toggle.querySelector(".jig-picker-toggle-thumb").outerHTML = url
    ? `<img class="jig-picker-toggle-thumb jig-thumb" src="${url}" alt="${lot.jig_tool_name}" />`
    : `<span class="jig-picker-toggle-thumb jig-thumb-placeholder">&#128736;&#65039;</span>`;
  toggle.querySelector(".jig-picker-toggle-label").textContent = lot.jig_tool_name;

  document.getElementById("req-location").value = lot.rack_location;
  document.getElementById("req-available").value = lot.current_qty;
  const qtyInput = document.getElementById("req-qty");
  qtyInput.value = 1;
  qtyInput.max = lot.current_qty;
  const preview = document.getElementById("req-image-preview");
  if (url) { preview.src = url; preview.style.display = "block"; }
  else { preview.style.display = "none"; }
}

document.getElementById("req-tech-id").addEventListener("blur", async () => {
  const id = document.getElementById("req-tech-id").value.trim().toLowerCase();
  const nameEl = document.getElementById("req-tech-name");
  nameEl.value = "";
  if (!id) return;
  try {
    const tech = await apiGet(`/api/technicians/${encodeURIComponent(id)}`);
    nameEl.value = tech.technician_name;
  } catch {
    nameEl.value = "WBI not found — contact admin";
  }
});

document.getElementById("btn-submit-request").addEventListener("click", async () => {
  const msg = document.getElementById("request-msg");
  hideMsg(msg);
  const lotId = Number(document.getElementById("req-lot").value);
  const techId = document.getElementById("req-tech-id").value.trim().toLowerCase();
  const handler = document.getElementById("req-handler").value.trim();
  const purpose = document.getElementById("req-purpose").value.trim();
  const qty = Number(document.getElementById("req-qty").value);
  if (!lotId || !techId || !handler || !purpose || !qty || qty < 1) {
    showMsg(msg, "Please fill in all required fields.", "error");
    return;
  }
  try {
    const result = await apiPost("/api/request", {
      lot_id: lotId, technician_id: techId, purpose, handler_no: handler, requested_qty: qty,
    });
    showMsg(msg, `${result.request_number} submitted — pending admin approval.`, "success");
    setTimeout(() => { activatePanel("main"); clearRequestForm(); refreshAll(); }, 1200);
  } catch (err) {
    showMsg(msg, err.message, "error");
  }
});

function clearRequestForm() {
  document.getElementById("req-dept").value = "";
  document.getElementById("req-lot").value = "";
  const toggle = document.getElementById("req-lot-toggle");
  toggle.disabled = true;
  toggle.querySelector(".jig-picker-toggle-thumb").outerHTML = `<span class="jig-picker-toggle-thumb jig-thumb-placeholder">&#128736;&#65039;</span>`;
  toggle.querySelector(".jig-picker-toggle-label").textContent = "-- Select department first --";
  document.getElementById("req-lot-picker").classList.remove("open");
  document.getElementById("req-lot-list").innerHTML = "";
  document.getElementById("req-tech-id").value = "";
  document.getElementById("req-tech-name").value = "";
  document.getElementById("req-location").value = "";
  document.getElementById("req-available").value = "";
  document.getElementById("req-qty").value = 1;
  document.getElementById("req-handler").value = "";
  document.getElementById("req-purpose").value = "";
  document.getElementById("req-image-preview").style.display = "none";
  hideMsg(document.getElementById("request-msg"));
}

// =====================================================
// RETURN POPUP
// =====================================================
function openReturnPopup(record) {
  currentReturnRecord = record;
  document.getElementById("return-title").textContent = `Return: ${record.jig_tool_name}`;
  document.getElementById("return-subtitle").textContent = `${record.request_number} · ${record.handler_no}`;
  document.getElementById("return-borrower-info").innerHTML =
    `<strong>Borrowed by:</strong> ${record.technician_name} &nbsp;·&nbsp; <strong>Qty to return:</strong> ${record.requested_qty} unit(s)`;
  document.getElementById("ret-tech-id").value = "";
  document.getElementById("ret-tech-name").value = "";
  hideMsg(document.getElementById("return-msg"));
  openPopup("modal-return");
}

document.getElementById("ret-tech-id").addEventListener("blur", async () => {
  const id = document.getElementById("ret-tech-id").value.trim().toLowerCase();
  const nameEl = document.getElementById("ret-tech-name");
  nameEl.value = "";
  if (!id) return;
  try {
    const tech = await apiGet(`/api/technicians/${encodeURIComponent(id)}`);
    nameEl.value = tech.technician_name;
  } catch { nameEl.value = "WBI not found"; }
});

document.getElementById("btn-confirm-return").addEventListener("click", async () => {
  const msg = document.getElementById("return-msg");
  hideMsg(msg);
  if (!currentReturnRecord) return;
  const retTechId = document.getElementById("ret-tech-id").value.trim().toLowerCase();
  if (!retTechId) { showMsg(msg, "Please enter the returning WBI.", "error"); return; }
  try {
    await apiPost(`/api/request/${currentReturnRecord.borrow_id}/return`, {
      returning_technician_id: retTechId,
    });
    showMsg(msg, "Return recorded successfully.", "success");
    setTimeout(() => { closePopup("modal-return"); refreshAll(); }, 1000);
  } catch (err) { showMsg(msg, err.message, "error"); }
});

// =====================================================
// APPROVE / REJECT
// =====================================================
function openApprovePopup(borrowId) {
  const r = allRequests.find(x => x.borrow_id === borrowId);
  if (!r) return;
  currentApproveRecord = r;
  document.getElementById("approve-title").textContent = "Review Request";
  document.getElementById("approve-subtitle").textContent = `${r.request_number} · Admin action required`;
  document.getElementById("approve-body").innerHTML = `
    <div class="form-row">
      <div><label>Request No</label><input value="${r.request_number}" readonly /></div>
      <div><label>Handler No</label><input value="${r.handler_no}" readonly /></div>
    </div>
    <label>Jig / Tool</label>
    <input value="${r.jig_tool_name}" readonly />
    <div class="form-row">
      <div><label>Dept</label><input value="${r.department}" readonly /></div>
      <div><label>Rack</label><input value="${r.rack_location}" readonly /></div>
    </div>
    <label>Technician</label>
    <input value="${r.technician_name}" readonly />
    <div class="form-row">
      <div><label>Qty</label><input value="${r.requested_qty} unit(s)" readonly /></div>
      <div><label>Submitted</label><input value="${formatDateTime(r.borrow_datetime)}" readonly /></div>
    </div>
    <label>Purpose</label>
    <input value="${r.purpose}" readonly />
  `;
  hideMsg(document.getElementById("approve-msg"));
  openPopup("modal-approve");
}

document.getElementById("btn-approve").addEventListener("click", async () => {
  if (!currentApproveRecord || !isAdmin()) return;
  const msg = document.getElementById("approve-msg");
  try {
    await apiPost(`/api/request/${currentApproveRecord.borrow_id}/approve`, { admin_username: adminSession.username });
    closePopup("modal-approve");
    refreshAll();
  } catch (err) { showMsg(msg, err.message, "error"); }
});

document.getElementById("btn-reject").addEventListener("click", async () => {
  if (!currentApproveRecord || !isAdmin()) return;
  const msg = document.getElementById("approve-msg");
  try {
    await apiPost(`/api/request/${currentApproveRecord.borrow_id}/reject`, { admin_username: adminSession.username });
    closePopup("modal-approve");
    refreshAll();
  } catch (err) { showMsg(msg, err.message, "error"); }
});

// =====================================================
// REQ DETAIL
// =====================================================
function openReqDetail(borrowId) {
  const r = allRequests.find(x => x.borrow_id === borrowId);
  if (!r) return;
  const status = getDisplayStatus(r);
  document.getElementById("reqd-title").textContent = `${r.request_number} — Details`;
  document.getElementById("reqd-subtitle").textContent = `${r.jig_tool_name} · ${status}`;
  document.getElementById("reqd-body").innerHTML = `
    <div class="form-row">
      <div><label>Request No</label><input value="${r.request_number}" readonly /></div>
      <div><label>Status</label><input value="${status}" readonly /></div>
    </div>
    <label>Jig / Tool</label>
    <input value="${r.jig_tool_name}" readonly />
    <div class="form-row">
      <div><label>Dept</label><input value="${r.department}" readonly /></div>
      <div><label>Rack</label><input value="${r.rack_location}" readonly /></div>
    </div>
    <div class="form-row">
      <div><label>Handler No</label><input value="${r.handler_no}" readonly /></div>
      <div><label>Qty</label><input value="${r.requested_qty} unit(s)" readonly /></div>
    </div>
    <label>Technician</label>
    <input value="${r.technician_name}" readonly />
    <label>Purpose</label>
    <input value="${r.purpose}" readonly />
    <label>Submitted At</label>
    <input value="${formatDateTime(r.borrow_datetime)}" readonly />
  `;
  openPopup("modal-req-detail");
}

// =====================================================
// STOCK HISTORY PANEL
// =====================================================
async function openLotHistoryPanel(lotNumber) {
  document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('.sidebar-item[data-panel="lot-history"]').classList.add("active");
  document.getElementById("panel-lot-history").classList.add("active");
  document.getElementById("lh-search").value = "";
  setDeptSectionExpanded("t2");
  renderStockHistoryList();
  const lot = allLots.find(l => l.lot_number === lotNumber);
  if (lot) await viewLotHistory(lot.lot_id, lotNumber);
}

document.getElementById("lh-search").addEventListener("input", renderStockHistoryList);

// ── Accordion: only one of Test 2 / Test 1 open at a time ──
let expandedDeptSection = "t2";

function setDeptSectionExpanded(deptKey) {
  expandedDeptSection = deptKey;
  for (const key of ["t2", "t1"]) {
    const isOpen = key === deptKey;
    document.getElementById(`lh-${key}-section`).style.display = isOpen ? "" : "none";
    document.getElementById(`lh-${key}-caret`).classList.toggle("collapsed", !isOpen);
  }
}

document.querySelectorAll(".dept-header-toggle[data-dept-toggle]").forEach(header => {
  header.addEventListener("click", () => {
    const key = header.dataset.deptToggle;
    setDeptSectionExpanded(expandedDeptSection === key ? null : key);
  });
});

document.getElementById("lh-machine-filter").addEventListener("change", renderStockHistoryList);

function renderStockHistoryList() {
  const filter = document.getElementById("lh-search").value.trim().toLowerCase();
  const machineFilter = document.getElementById("lh-machine-filter").value;
  const matches = (l) => {
    if (machineFilter && l.machine !== machineFilter) return false;
    return !filter || `${l.jig_tool_name} ${l.rack_location}`.toLowerCase().includes(filter);
  };
  renderStockHistorySection(allLots.filter(l => l.department === "Test 2" && matches(l)), "lh-t2-tbody", "lh-t2-empty");
  renderStockHistorySection(allLots.filter(l => l.department === "Test 1" && matches(l)), "lh-t1-tbody", "lh-t1-empty");
}

function renderStockHistorySection(rows, tbodyId, emptyId) {
  const tbody = document.getElementById(tbodyId);
  const empty = document.getElementById(emptyId);
  tbody.innerHTML = "";
  if (rows.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";
  for (const lot of rows) {
    const tr = document.createElement("tr");
    tr.className = "lh-row";
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${thumbHtml(lot)}</td>
      <td>${lot.jig_tool_name}</td>
      <td>${lot.rack_location}</td>
      <td>${lot.current_qty}</td>
    `;
    tr.addEventListener("click", () => viewLotHistory(lot.lot_id, lot.lot_number));
    tbody.appendChild(tr);
  }
}

async function viewLotHistory(lotId, lotNumber) {
  try {
    const history = await apiGet(`/api/lots/${lotId}/history`);
    const lot = allLots.find(l => l.lot_id === lotId);
    currentLotHistory = { lotId, lotNumber, history, lot };
    const outNow = allRequests
      .filter(r => r.lot_id === lotId && (getDisplayStatus(r) === "active" || getDisplayStatus(r) === "overdue"))
      .reduce((s, r) => s + r.requested_qty, 0);
    document.getElementById("lh-summary-boxes").innerHTML = `
      <div class="lot-sum-box"><div class="lot-sum-val">${lot ? lot.current_qty : "—"}</div><div class="lot-sum-label">Current Qty</div></div>
      <div class="lot-sum-box warn"><div class="lot-sum-val">${outNow}</div><div class="lot-sum-label">Out Now</div></div>
      <div class="lot-sum-box"><div class="lot-sum-val">${lot ? lot.rack_location : "—"}</div><div class="lot-sum-label">Rack Location</div></div>
    `;
    const displayName = lot ? lot.jig_tool_name : lotNumber;
    document.getElementById("lh-detail-title").textContent = `${displayName} — Transaction Log`;

    const img = document.getElementById("lh-detail-image");
    const placeholder = document.getElementById("lh-detail-placeholder");
    const url = lot ? imageUrl(lot.jig_tool_id, lot.has_image) : null;
    if (url) {
      img.src = url;
      img.alt = displayName;
      img.style.display = "block";
      placeholder.style.display = "none";
    } else {
      img.style.display = "none";
      placeholder.style.display = "flex";
    }

    document.getElementById("lh-detail").style.display = "block";
    document.getElementById("btn-export-excel").style.display = "inline-flex";

    // Collapse whichever list is open so the log isn't buried under a long item
    // list, then scroll it into view — no manual scrolling needed to see it.
    setDeptSectionExpanded(null);
    document.getElementById("lh-detail").scrollIntoView({ behavior: "smooth", block: "start" });

    const tbody = document.getElementById("lh-log-tbody");
    const empty = document.getElementById("lh-log-empty");
    if (history.length === 0) { tbody.innerHTML = ""; empty.style.display = "block"; return; }
    empty.style.display = "none";
    tbody.innerHTML = "";
    for (const h of history) {
      const qtyChange = h.qty_change > 0 ? `+${h.qty_change}` : h.qty_change;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${formatDateTime(h.created_at)}</td>
        <td>${actionBadge(h.action_type)}</td>
        <td style="font-weight:600;color:${h.qty_change>0?'var(--ok)':h.qty_change<0?'var(--danger)':'var(--muted)'}">${qtyChange||"—"}</td>
        <td>${h.qty_before??"—"}</td>
        <td>${h.qty_after??"—"}</td>
        <td>${h.technician_name||h.admin_username||"—"}</td>
        <td style="max-width:200px;white-space:normal;font-size:12px;">${h.reason||h.notes||"—"}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) { console.error("viewLotHistory:", err); }
}

document.getElementById("btn-export-excel").addEventListener("click", () => {
  if (!currentLotHistory) return;
  const { lotNumber, history } = currentLotHistory;
  const rows = [["Date & Time","Action","Qty Change","Before","After","Technician / Admin","Reason / Notes"]];
  for (const h of history) {
    rows.push([formatDateTime(h.created_at), h.action_type, h.qty_change||"", h.qty_before??"", h.qty_after??"", h.technician_name||h.admin_username||"", h.reason||h.notes||""]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `LotHistory_${lotNumber}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// =====================================================
// UPDATE JIG/TOOL LIST (ADMIN)
// =====================================================
document.getElementById("pkg-machine-filter").addEventListener("change", loadUpdatePackages);

async function loadUpdatePackages() {
  try {
    const data = await apiGet("/api/lots");
    populateMachineFilterOptions();
    const machineFilter = document.getElementById("pkg-machine-filter").value;
    const matches = (r) => !machineFilter || r.machine === machineFilter;
    renderUpdateTable(data.filter(r => r.department === "Test 2" && matches(r)), "pkg-t2-tbody", "pkg-t2-empty");
    renderUpdateTable(data.filter(r => r.department === "Test 1" && matches(r)), "pkg-t1-tbody", "pkg-t1-empty");
  } catch (err) { console.error(err); }
}

function renderUpdateTable(rows, tbodyId, emptyId) {
  const tbody = document.getElementById(tbodyId);
  const empty = document.getElementById(emptyId);
  if (rows.length === 0) { empty.style.display = "block"; tbody.innerHTML = ""; return; }
  empty.style.display = "none";
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${thumbHtml(r)}</td>
      <td><span class="lot-tag" data-lot="${r.lot_number}" style="cursor:pointer;">${r.jig_tool_name}</span></td>
      <td>${r.rack_location}</td>
      <td>${r.current_qty}</td>
      <td>
        <button class="btn-edit-row" data-lotid="${r.lot_id}">Edit</button>
        <button class="btn-delete-row" data-lotid="${r.lot_id}" data-name="${r.jig_tool_name}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".lot-tag[data-lot]").forEach(el => {
    el.addEventListener("click", () => openLotHistoryPanel(el.dataset.lot));
  });
  tbody.querySelectorAll(".btn-edit-row").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = rows.find(x => x.lot_id === Number(btn.dataset.lotid));
      if (r) openUpdateLot(r);
    });
  });
  tbody.querySelectorAll(".btn-delete-row").forEach(btn => {
    btn.addEventListener("click", () => deleteLot(Number(btn.dataset.lotid), btn.dataset.name));
  });
}

function openUpdateLot(lot) {
  currentUpdateLot = lot;
  document.getElementById("ul-title").textContent = "Update Details";
  document.getElementById("ul-subtitle").textContent = lot.jig_tool_name;
  document.getElementById("ul-current-qty").value = lot.current_qty;
  document.getElementById("ul-new-qty").value = "";
  document.getElementById("ul-location").value = lot.rack_location;
  hideMsg(document.getElementById("ul-msg"));
  openPopup("modal-update-lot");
}

document.getElementById("btn-save-lot-update").addEventListener("click", async () => {
  if (!currentUpdateLot || !isAdmin()) return;
  const msg = document.getElementById("ul-msg");
  hideMsg(msg);
  const newQtyStr = document.getElementById("ul-new-qty").value;
  const newLocation = document.getElementById("ul-location").value.trim();
  const reason = document.getElementById("ul-reason").value;
  const payload = { reason, admin_username: adminSession.username };
  if (newQtyStr !== "") payload.new_qty = Number(newQtyStr);
  if (newLocation && newLocation !== currentUpdateLot.rack_location) payload.rack_location = newLocation;
  try {
    await apiPatch(`/api/lots/${currentUpdateLot.lot_id}`, payload);
    showMsg(msg, "Updated.", "success");
    setTimeout(() => { closePopup("modal-update-lot"); loadUpdatePackages(); refreshAll(); }, 800);
  } catch (err) { showMsg(msg, err.message, "error"); }
});

async function deleteLot(lotId, name) {
  if (!isAdmin()) return;
  if (!confirm(`Delete '${name}'? This cannot be undone.`)) return;
  try {
    await apiDelete(`/api/lots/${lotId}?admin_username=${encodeURIComponent(adminSession.username)}`);
    loadUpdatePackages();
    refreshAll();
  } catch (err) { alert(`Cannot delete: ${err.message}`); }
}

// =====================================================
// REGISTER PANEL
// =====================================================
let packagesCache = [];

async function loadPackagesForRegister() {
  try {
    packagesCache = await apiGet("/api/jigs");
    const sel = document.getElementById("lot-package");
    sel.innerHTML = '<option value="">-- Select jig / tool --</option>' +
      packagesCache.map(p => `<option value="${p.jig_tool_id}">${p.jig_tool_name} (${p.item_type} · ${p.department})</option>`).join("");
  } catch (err) { console.error(err); }
}

document.getElementById("lot-package").addEventListener("change", () => {
  const pkg = packagesCache.find(p => p.jig_tool_id === Number(document.getElementById("lot-package").value));
  document.getElementById("lot-location").value = pkg ? pkg.default_location : "";
  document.getElementById("lot-qty").value = pkg ? pkg.default_qty : "";
});

document.getElementById("tech-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("tech-msg");
  try {
    const payload = {
      technician_id: document.getElementById("tech-wbi").value.trim().toLowerCase(),
      technician_name: document.getElementById("tech-name").value.trim(),
      department: document.getElementById("tech-dept").value,
    };
    await apiPost("/api/technicians", payload);
    showMsg(msg, `Technician "${payload.technician_name}" registered.`, "success");
    e.target.reset();
  } catch (err) { showMsg(msg, err.message, "error"); }
});

document.getElementById("pkg-image").addEventListener("change", () => {
  const file = document.getElementById("pkg-image").files[0];
  const preview = document.getElementById("pkg-image-preview");
  if (!file) { preview.style.display = "none"; return; }
  const reader = new FileReader();
  reader.onload = () => { preview.src = reader.result; preview.style.display = "block"; };
  reader.readAsDataURL(file);
});

document.getElementById("package-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("package-msg");
  try {
    const formData = new FormData();
    formData.append("jig_tool_name", document.getElementById("pkg-name").value.trim());
    formData.append("item_type", document.getElementById("pkg-type").value);
    formData.append("department", document.getElementById("pkg-dept").value);
    formData.append("process", document.getElementById("pkg-process").value);
    formData.append("machine", document.getElementById("pkg-machine").value);
    formData.append("default_location", document.getElementById("pkg-location").value.trim());
    formData.append("default_qty", Number(document.getElementById("pkg-qty").value));
    const file = document.getElementById("pkg-image").files[0];
    if (file) formData.append("image", file);

    const result = await apiPostForm("/api/jigs", formData);
    showMsg(msg, `Jig/Tool "${result.jig_tool_name}" added.`, "success");
    e.target.reset();
    document.getElementById("pkg-image-preview").style.display = "none";
    loadPackagesForRegister();
  } catch (err) { showMsg(msg, err.message, "error"); }
});

document.getElementById("lot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("lot-msg");
  const payload = {
    jig_tool_id: Number(document.getElementById("lot-package").value),
    rack_location: document.getElementById("lot-location").value.trim(),
    initial_qty: Number(document.getElementById("lot-qty").value),
  };
  if (!payload.jig_tool_id) { showMsg(msg, "Please select a jig / tool.", "error"); return; }
  try {
    const lot = await apiPost("/api/lots", payload);
    showMsg(msg, `${lot.jig_tool_name} added to stock.`, "success");
    e.target.reset();
    loadAllLots();
    loadPackagesForRegister();
  } catch (err) { showMsg(msg, err.message, "error"); }
});

// =====================================================
// BULK IMPORT (ADMIN)
// =====================================================
document.getElementById("bulk-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("bulk-msg");
  hideMsg(msg);
  document.getElementById("bulk-results").style.display = "none";

  const dept = document.getElementById("bulk-dept").value;
  const file = document.getElementById("bulk-file").files[0];
  if (!dept) { showMsg(msg, "Please select a department.", "error"); return; }
  if (!file) { showMsg(msg, "Please choose a spreadsheet file.", "error"); return; }

  const formData = new FormData();
  formData.append("department", dept);
  formData.append("admin_username", adminSession.username);
  formData.append("file", file);
  const images = document.getElementById("bulk-images").files;
  for (const img of images) formData.append("images", img);

  showMsg(msg, "Importing — this can take a moment for large sheets...", "success");
  try {
    const result = await apiPostForm("/api/jigs/bulk-import", formData);
    showMsg(msg, `Import finished: ${result.created_count} created, ${result.skipped_count} skipped, ${result.error_count} errors.`, "success");

    const tbody = document.getElementById("bulk-summary-tbody");
    tbody.innerHTML = `
      <tr><td>Created</td><td>${result.created_count}</td></tr>
      <tr><td>Skipped (already existed)</td><td>${result.skipped_count}</td></tr>
      <tr><td>Errors</td><td>${result.error_count}</td></tr>
      <tr><td>Pictures embedded in sheet</td><td>${result.pictures_embedded_in_sheet}</td></tr>
      <tr><td>Pictures uploaded separately</td><td>${result.pictures_uploaded}</td></tr>
      <tr><td>Pictures matched to a row</td><td>${result.pictures_matched}</td></tr>
    `;
    const details = document.getElementById("bulk-details");
    const lines = [];
    if (result.skipped.length) lines.push("<strong>Skipped:</strong><br>" + result.skipped.join("<br>"));
    if (result.errors.length) lines.push("<strong>Errors:</strong><br>" + result.errors.join("<br>"));
    details.innerHTML = lines.join("<br><br>");
    document.getElementById("bulk-results").style.display = "block";

    loadAllLots();
    loadPackagesForRegister();
    loadUpdatePackages();
  } catch (err) {
    showMsg(msg, err.message, "error");
  }
});

// =====================================================
// INIT
// =====================================================
refreshAll();
setInterval(refreshAll, 60000);
