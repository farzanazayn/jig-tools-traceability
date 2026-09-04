// =====================================================
// Jig & Tools Maintenance Traceability System — app.js
// =====================================================

let allRequests = [];
let allLots = [];
let allMissing = [];
let currentReturnRecord = null;
let currentApproveRecord = null;
let currentUpdateLot = null;
let currentResolveMissing = null;
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

// ── Sidebar navigation ──────────────────────────────
document.querySelectorAll(".sidebar-item[data-panel]").forEach(item => {
  item.addEventListener("click", () => {
    if (item.classList.contains("admin-only") && !isAdmin()) return;
    document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    item.classList.add("active");
    document.getElementById(`panel-${item.dataset.panel}`).classList.add("active");
    if (item.dataset.panel === "update-packages") loadUpdatePackages();
    if (item.dataset.panel === "register") loadPackagesForRegister();
    if (item.dataset.panel === "queued") renderQueuedList();
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
  } catch (err) { console.error("loadAllLots:", err); }
}

async function loadMissingUnits() {
  try {
    allMissing = await apiGet("/api/dashboard/missing");
    renderMissingList();
  } catch (err) { console.error("loadMissing:", err); }
}

function refreshAll() {
  loadAllRequests();
  loadAllLots();
  loadMissingUnits();
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
    QTY_UPDATE: "action-update", REPLENISHMENT: "action-update",
    LOCATION_CHANGE: "action-update", REGISTERED: "action-reg",
    LOT_NUMBER_CHANGE: "action-update",
    MISSING_RESOLVED: "action-missing",
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
      const hay = `${r.request_number} ${r.handler_no} ${r.lot_number} ${r.technician_name} ${r.jig_tool_name}`.toLowerCase();
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
      <td><span class="lot-tag" data-lot="${r.lot_number}" style="cursor:pointer;">${r.lot_number}</span></td>
      <td>${r.jig_tool_name}</td>
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
// MISSING UNIT LIST
// =====================================================
function renderMissingList() {
  const tbody = document.getElementById("missing-tbody");
  const empty = document.getElementById("missing-empty");
  const header = document.getElementById("missing-action-header");
  if (header) header.textContent = isAdmin() ? "Action" : "";

  tbody.innerHTML = "";
  if (allMissing.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  for (const m of allMissing) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.jig_tool_name}</td>
      <td><span class="lot-tag">${m.lot_number}</span></td>
      <td>${m.technician_name}</td>
      <td style="color:var(--danger); font-weight:600;">${m.missing_qty}</td>
      <td>${formatDateTime(m.return_datetime)}</td>
      <td>${m.duration}</td>
      <td>${isAdmin() ? `<button class="btn-update-missing" data-id="${m.return_id}">Update</button>` : ""}</td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".btn-update-missing[data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const m = allMissing.find(x => x.return_id === Number(btn.dataset.id));
      if (m) openResolveMissing(m);
    });
  });
}

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
      <td><span class="lot-tag">${r.lot_number}</span></td>
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
    renderMissingList();
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
    renderMissingList();
    renderQueuedList();
  } catch (err) {
    showMsg(msg, err.message, "error");
  }
});

// =====================================================
// REQUEST POPUP
// =====================================================
document.getElementById("btn-open-request").addEventListener("click", async () => {
  await loadAllLots();
  clearRequestForm();
  openPopup("modal-request");
});

document.getElementById("req-dept").addEventListener("change", () => {
  const dept = document.getElementById("req-dept").value;
  const sel = document.getElementById("req-lot");
  sel.disabled = !dept;
  sel.innerHTML = '<option value="">-- Select jig / tool --</option>';
  document.getElementById("req-image-preview").style.display = "none";
  if (!dept) return;
  const filtered = allLots.filter(l => l.department === dept && l.current_qty > 0);
  filtered.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.lot_id;
    opt.textContent = `${l.jig_tool_name} - ${l.lot_number} (Avail: ${l.current_qty})`;
    sel.appendChild(opt);
  });
});

document.getElementById("req-lot").addEventListener("change", () => {
  const lot = allLots.find(l => l.lot_id === Number(document.getElementById("req-lot").value));
  document.getElementById("req-location").value = lot ? lot.rack_location : "";
  document.getElementById("req-available").value = lot ? lot.current_qty : "";
  const qtyInput = document.getElementById("req-qty");
  qtyInput.value = 1;
  qtyInput.max = lot ? lot.current_qty : "";
  const preview = document.getElementById("req-image-preview");
  const url = lot ? imageUrl(lot.jig_tool_id, lot.has_image) : null;
  if (url) { preview.src = url; preview.style.display = "block"; }
  else { preview.style.display = "none"; }
});

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
    setTimeout(() => { closePopup("modal-request"); clearRequestForm(); refreshAll(); }, 1200);
  } catch (err) {
    showMsg(msg, err.message, "error");
  }
});

function clearRequestForm() {
  document.getElementById("req-dept").value = "";
  const sel = document.getElementById("req-lot");
  sel.innerHTML = '<option value="">-- Select department first --</option>';
  sel.disabled = true;
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
  document.getElementById("return-title").textContent = `Return: ${record.jig_tool_name} — ${record.lot_number}`;
  document.getElementById("return-subtitle").textContent = `${record.request_number} · ${record.handler_no}`;
  document.getElementById("return-borrower-info").innerHTML =
    `<strong>Borrowed by:</strong> ${record.technician_name} &nbsp;·&nbsp; <strong>Qty borrowed:</strong> ${record.requested_qty} unit(s)`;
  document.getElementById("ret-tech-id").value = "";
  document.getElementById("ret-tech-name").value = "";
  document.getElementById("ret-good").value = record.requested_qty;
  document.getElementById("ret-damaged").value = 0;
  document.getElementById("ret-missing").value = 0;
  hideMsg(document.getElementById("return-msg"));
  updateReturnTotals();
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

["ret-good", "ret-damaged", "ret-missing"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateReturnTotals);
});

function updateReturnTotals() {
  if (!currentReturnRecord) return;
  const borrowed = currentReturnRecord.requested_qty;
  const sum = ["ret-good", "ret-damaged", "ret-missing"]
    .reduce((s, id) => s + (Number(document.getElementById(id).value) || 0), 0);
  const el = document.getElementById("return-totals");
  if (sum === borrowed) {
    el.className = "totals-check";
    el.textContent = `Good + Damaged + Missing = ${sum} — matches borrowed qty ✓`;
  } else {
    el.className = "totals-check mismatch";
    el.textContent = `Total = ${sum}, but borrowed qty = ${borrowed}. Must be equal.`;
  }
}

document.getElementById("btn-confirm-return").addEventListener("click", async () => {
  const msg = document.getElementById("return-msg");
  hideMsg(msg);
  if (!currentReturnRecord) return;
  const good    = Number(document.getElementById("ret-good").value)    || 0;
  const damaged = Number(document.getElementById("ret-damaged").value) || 0;
  const missing = Number(document.getElementById("ret-missing").value) || 0;
  const retTechId = document.getElementById("ret-tech-id").value.trim().toLowerCase();
  if (!retTechId) { showMsg(msg, "Please enter the returning WBI.", "error"); return; }
  const total = good + damaged + missing;
  if (total !== currentReturnRecord.requested_qty) {
    showMsg(msg, `Breakdown total (${total}) must equal borrowed qty (${currentReturnRecord.requested_qty}).`, "error");
    return;
  }
  try {
    await apiPost(`/api/request/${currentReturnRecord.borrow_id}/return`, {
      good_qty: good, damaged_qty: damaged, missing_qty: missing,
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
    <label>Jig / Tool / Lot</label>
    <input value="${r.jig_tool_name} — ${r.lot_number}" readonly />
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
  document.getElementById("reqd-subtitle").textContent = `${r.jig_tool_name} · ${r.lot_number} · ${status}`;
  document.getElementById("reqd-body").innerHTML = `
    <div class="form-row">
      <div><label>Request No</label><input value="${r.request_number}" readonly /></div>
      <div><label>Status</label><input value="${status}" readonly /></div>
    </div>
    <div class="form-row">
      <div><label>Lot No</label><input value="${r.lot_number}" readonly /></div>
      <div><label>Jig / Tool</label><input value="${r.jig_tool_name}" readonly /></div>
    </div>
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
// LOT HISTORY PANEL
// =====================================================
async function openLotHistoryPanel(lotNumber) {
  document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('.sidebar-item[data-panel="lot-history"]').classList.add("active");
  document.getElementById("panel-lot-history").classList.add("active");
  document.getElementById("lh-search").value = lotNumber;
  document.getElementById("lh-rack").value = "";
  await searchLotHistory();
  const lot = allLots.find(l => l.lot_number === lotNumber);
  if (lot) await viewLotHistory(lot.lot_id, lotNumber);
}

document.getElementById("btn-lh-search").addEventListener("click", searchLotHistory);
document.getElementById("lh-search").addEventListener("keydown", e => { if (e.key === "Enter") searchLotHistory(); });
document.getElementById("lh-rack").addEventListener("keydown", e => { if (e.key === "Enter") searchLotHistory(); });

async function searchLotHistory() {
  const search = document.getElementById("lh-search").value.trim();
  const rack = document.getElementById("lh-rack").value.trim();
  if (!search && !rack) return;
  try {
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    if (rack) params.append("rack_location", rack);
    const results = await apiGet(`/api/dashboard/lot-history?${params}`);
    const tbody = document.getElementById("lh-search-tbody");
    const resultsDiv = document.getElementById("lh-results");
    const detailDiv = document.getElementById("lh-detail");
    detailDiv.style.display = "none";
    document.getElementById("btn-export-excel").style.display = "none";
    resultsDiv.style.display = "block";
    if (results.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">No matching jigs/tools found.</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    for (const lot of results) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="lot-tag">${lot.lot_number}</span></td>
        <td>${lot.jig_tool_name}</td>
        <td>${lot.department}</td>
        <td>${lot.rack_location}</td>
        <td>${lot.current_qty}</td>
        <td><button class="btn btn-sm" data-lotid="${lot.lot_id}" data-lotno="${lot.lot_number}">View History</button></td>
      `;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll("button[data-lotid]").forEach(btn => {
      btn.addEventListener("click", () => viewLotHistory(Number(btn.dataset.lotid), btn.dataset.lotno));
    });
  } catch (err) { console.error("searchLotHistory:", err); }
}

async function viewLotHistory(lotId, lotNumber) {
  try {
    const history = await apiGet(`/api/lots/${lotId}/history`);
    const lot = allLots.find(l => l.lot_id === lotId);
    currentLotHistory = { lotId, lotNumber, history, lot };
    const totalDefect = lot ? (lot.total_damaged + lot.total_missing) : 0;
    const outNow = allRequests
      .filter(r => r.lot_id === lotId && (getDisplayStatus(r) === "active" || getDisplayStatus(r) === "overdue"))
      .reduce((s, r) => s + r.requested_qty, 0);
    document.getElementById("lh-summary-boxes").innerHTML = `
      <div class="lot-sum-box"><div class="lot-sum-val">${lot ? lot.current_qty : "—"}</div><div class="lot-sum-label">Current Qty</div></div>
      <div class="lot-sum-box warn"><div class="lot-sum-val">${outNow}</div><div class="lot-sum-label">Out Now</div></div>
      <div class="lot-sum-box danger"><div class="lot-sum-val">${totalDefect}</div><div class="lot-sum-label">Damaged &amp; Loss</div></div>
      <div class="lot-sum-box"><div class="lot-sum-val">${lot ? lot.rack_location : "—"}</div><div class="lot-sum-label">Rack Location</div></div>
    `;
    document.getElementById("lh-detail-title").textContent = `${lotNumber} — Transaction Log`;
    document.getElementById("lh-detail").style.display = "block";
    document.getElementById("btn-export-excel").style.display = "inline-flex";
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
async function loadUpdatePackages() {
  try {
    const data = await apiGet("/api/dashboard/replenishment");
    renderUpdateTable(data.filter(r => r.department === "Test 2"), "pkg-t2-tbody", "pkg-t2-empty");
    renderUpdateTable(data.filter(r => r.department === "Test 1"), "pkg-t1-tbody", "pkg-t1-empty");
  } catch (err) { console.error(err); }
}

function renderUpdateTable(rows, tbodyId, emptyId) {
  const tbody = document.getElementById(tbodyId);
  const empty = document.getElementById(emptyId);
  if (rows.length === 0) { empty.style.display = "block"; tbody.innerHTML = ""; return; }
  empty.style.display = "none";
  tbody.innerHTML = "";
  for (const r of rows) {
    const badge = r.status === "REPLENISH"
      ? `<span class="badge badge-overdue">Replenish</span>`
      : `<span class="badge badge-active">OK</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${thumbHtml(r)}</td>
      <td><span class="lot-tag" data-lot="${r.lot_number}" style="cursor:pointer;">${r.lot_number}</span></td>
      <td>${r.jig_tool_name}</td>
      <td>${r.rack_location}</td>
      <td>${r.current_qty}</td>
      <td>${r.total_damaged}</td>
      <td>${r.total_missing}</td>
      <td>${r.replenish_limit}</td>
      <td>${badge}</td>
      <td>
        <button class="btn-edit-row" data-lotid="${r.lot_id}">Edit</button>
        <button class="btn-delete-row" data-lotid="${r.lot_id}" data-lotno="${r.lot_number}">Delete</button>
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
    btn.addEventListener("click", () => deleteLot(Number(btn.dataset.lotid), btn.dataset.lotno));
  });
}

function openUpdateLot(lot) {
  currentUpdateLot = lot;
  document.getElementById("ul-title").textContent = "Update Details";
  document.getElementById("ul-subtitle").textContent = `${lot.jig_tool_name} — ${lot.lot_number}`;
  document.getElementById("ul-lot-number").value = lot.lot_number;
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
  const newLotNumber = document.getElementById("ul-lot-number").value.trim();
  const reason = document.getElementById("ul-reason").value;
  const payload = { reason, admin_username: adminSession.username };
  if (newQtyStr !== "") payload.new_qty = Number(newQtyStr);
  if (newLocation && newLocation !== currentUpdateLot.rack_location) payload.rack_location = newLocation;
  if (newLotNumber && newLotNumber !== currentUpdateLot.lot_number) payload.lot_number = newLotNumber;
  try {
    await apiPatch(`/api/lots/${currentUpdateLot.lot_id}`, payload);
    showMsg(msg, "Lot updated.", "success");
    setTimeout(() => { closePopup("modal-update-lot"); loadUpdatePackages(); refreshAll(); }, 800);
  } catch (err) { showMsg(msg, err.message, "error"); }
});

async function deleteLot(lotId, lotNumber) {
  if (!isAdmin()) return;
  if (!confirm(`Delete lot ${lotNumber}? This cannot be undone.`)) return;
  try {
    await apiDelete(`/api/lots/${lotId}?admin_username=${encodeURIComponent(adminSession.username)}`);
    loadUpdatePackages();
    refreshAll();
  } catch (err) { alert(`Cannot delete: ${err.message}`); }
}

// =====================================================
// RESOLVE MISSING UNIT
// =====================================================
function openResolveMissing(m) {
  currentResolveMissing = m;
  document.getElementById("rm-subtitle").textContent = `${m.jig_tool_name} — ${m.lot_number}`;
  document.getElementById("rm-info").innerHTML =
    `<strong>Technician:</strong> ${m.technician_name} &nbsp;·&nbsp; <strong>Missing:</strong> ${m.missing_qty} unit(s)`;
  document.getElementById("rm-good").value = 0;
  document.getElementById("rm-damaged").value = 0;
  hideMsg(document.getElementById("rm-msg"));
  openPopup("modal-resolve-missing");
}

document.getElementById("btn-confirm-resolve").addEventListener("click", async () => {
  if (!currentResolveMissing || !isAdmin()) return;
  const msg = document.getElementById("rm-msg");
  hideMsg(msg);
  const good = Number(document.getElementById("rm-good").value) || 0;
  const damaged = Number(document.getElementById("rm-damaged").value) || 0;
  if (good + damaged > currentResolveMissing.missing_qty) {
    showMsg(msg, `Total (${good+damaged}) cannot exceed missing qty (${currentResolveMissing.missing_qty}).`, "error");
    return;
  }
  try {
    await apiPost(`/api/dashboard/missing/${currentResolveMissing.return_id}/resolve`, {
      good_qty_recovered: good, damaged_qty: damaged, admin_username: adminSession.username,
    });
    showMsg(msg, "Missing jig/tool case resolved.", "success");
    setTimeout(() => { closePopup("modal-resolve-missing"); refreshAll(); }, 1000);
  } catch (err) { showMsg(msg, err.message, "error"); }
});

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
    lot_number: document.getElementById("lot-number").value.trim(),
    rack_location: document.getElementById("lot-location").value.trim(),
    initial_qty: Number(document.getElementById("lot-qty").value),
    replenish_limit: Number(document.getElementById("lot-limit").value) || 5,
  };
  if (!payload.jig_tool_id) { showMsg(msg, "Please select a jig / tool.", "error"); return; }
  try {
    const lot = await apiPost("/api/lots", payload);
    showMsg(msg, `Lot ${lot.lot_number} registered.`, "success");
    e.target.reset();
    document.getElementById("lot-limit").value = 5;
    loadAllLots();
    loadPackagesForRegister();
  } catch (err) { showMsg(msg, err.message, "error"); }
});

// =====================================================
// INIT
// =====================================================
refreshAll();
setInterval(refreshAll, 60000);
