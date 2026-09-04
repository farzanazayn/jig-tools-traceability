const API = window.location.pathname.startsWith("/jigtools") ? "/jigtools" : "";

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

async function apiPostForm(path, formData) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

async function errorDetail(res) {
  try {
    const d = await res.json();
    return d.detail || JSON.stringify(d);
  } catch {
    return `Request failed (${res.status})`;
  }
}

// ── Admin session ──────────────────────────────────────
let adminSession = null;

function isAdmin() { return adminSession !== null; }

function setAdmin(data) {
  adminSession = data;
  updateAdminUI();
}

function clearAdmin() {
  adminSession = null;
  updateAdminUI();
}

function updateAdminUI() {
  const adminBtn = document.getElementById("btn-admin-login");
  const adminItems = document.querySelectorAll(".admin-only");
  if (isAdmin()) {
    if (adminBtn) {
      adminBtn.innerHTML = `Logout (${adminSession.full_name})`;
      adminBtn.style.background = "rgba(192,104,124,0.3)";
    }
    adminItems.forEach(el => el.style.display = "flex");
  } else {
    if (adminBtn) {
      adminBtn.innerHTML = "Admin Login";
      adminBtn.style.background = "";
    }
    adminItems.forEach(el => el.style.display = "none");
  }
}

// ── Formatting helpers ─────────────────────────────────
function formatDateTime(dtStr) {
  if (!dtStr) return "—";
  // Backend returns UTC without Z — parse as-is (local display)
  const d = new Date(dtStr.replace("T", " "));
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(dtStr) {
  if (!dtStr) return "—";
  const start = new Date(dtStr.replace("T", " "));
  const diff = Math.floor((Date.now() - start.getTime()) / 60000);
  if (diff < 1) return "Just now";
  const d = Math.floor(diff / 1440);
  const h = Math.floor((diff % 1440) / 60);
  const m = diff % 60;
  const out = [];
  if (d) out.push(`${d}d`);
  if (h) out.push(`${h}h`);
  if (m || !out.length) out.push(`${m}m`);
  return out.join(" ");
}

function isOverdue(dtStr, days = 14) {
  if (!dtStr) return false;
  const start = new Date(dtStr.replace("T", " "));
  return (Date.now() - start.getTime()) / 86400000 > days;
}

// ── Message helpers ────────────────────────────────────
function showMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = `msg ${type}`;
  el.style.display = "block";
}

function hideMsg(el) {
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}

// ── Popup helpers ──────────────────────────────────────
function openPopup(id) {
  document.getElementById(id).classList.add("open");
}

function closePopup(id) {
  document.getElementById(id).classList.remove("open");
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) {
    e.target.classList.remove("open");
  }
});
