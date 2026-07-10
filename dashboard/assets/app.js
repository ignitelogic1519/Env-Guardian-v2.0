/* ── Env Guardian — Admin Console SPA ─────────────────────────────────────────
   Vanilla JS single-page app. Signs in against the Env Guardian backend
   (POST /api/auth/login → JWT), then gates every page and action on the role
   stored in the database (users.role: admin / manager / viewer). The server
   enforces the same matrix — the UI gating is convenience, not security. */

(() => {
"use strict";

// ═══════════ CONFIG / STATE ═══════════
const CFG = window.EG_CONFIG || {};
const apiBase = () => (localStorage.getItem("eg_api_base") || CFG.API_BASE || "").replace(/\/+$/, "");

let session = null;             // { token, user:{id,username,fullName,role,org} }
let pageTimers = [];            // intervals owned by the current page
let currentPage = null;

try { session = JSON.parse(sessionStorage.getItem("eg_session")); } catch {}

// ═══════════ RBAC MATRIX ═══════════
const ALL = ["admin", "manager", "viewer"];
const PAGES = [
  { id: "home", title: "Home", roles: ALL, icon: "home" },
  { sec: "Monitor" },
  { id: "overview", title: "Overview",          roles: ALL,                  icon: "grid" },
  { id: "devices",  title: "Devices",           roles: ALL,                  icon: "phone" },
  { id: "metrics",  title: "Metrics",           roles: ALL,                  icon: "chart" },
  { sec: "Operate" },
  { id: "policies", title: "Policy Controller", roles: ["admin", "manager"], icon: "sliders" },
  { id: "qr",       title: "QR Settings",       roles: ["admin", "manager"], icon: "qr" },
  { id: "enroll",   title: "Enrollment",        roles: ["admin", "manager"], icon: "plus" },
  { sec: "Administer" },
  { id: "users",    title: "Users & Roles",     roles: ["admin"],            icon: "users" },
  { id: "settings", title: "Settings",          roles: ["admin"],            icon: "gear" },
];
const CAN = {
  lock:      ["admin", "manager"],
  whitelist: ["admin", "manager"],
  policy:    ["admin", "manager"],
  geofence:  ["admin", "manager"],
  unenroll:  ["admin"],
  qrManage:  ["admin"],
  password:  ["admin"],
};
const can = (act) => session && CAN[act]?.includes(session.user.role);
const role = () => session?.user?.role || "";

// What each section is for — powers the Home page cards.
const PAGE_INFO = {
  overview: {
    desc: "Your live command center. A snapshot of the whole fleet the moment you open it.",
    points: ["KPI tiles: enrolled, online, in-zone, compliance rate, logins",
             "Devices needing attention surface first (locked, non-compliant, in-zone)",
             "Auto-refreshes — click any device card to manage it"],
  },
  devices: {
    desc: "The full device inventory — search, filter and administer every enrolled phone.",
    points: ["Search by name, employee ID or model across the entire fleet",
             "Per-device panel: compliance matrix, remote lock, whitelist, usage",
             "Filters: online, in-zone, locked, non-compliant"],
  },
  metrics: {
    desc: "Numbers over time: sign-ins, compliance, and what the fleet is actually using.",
    points: ["Console logins per day (last 14 days)",
             "Compliant vs non-compliant split + per-device scores",
             "Top apps used inside the zone today"],
  },
  policies: {
    desc: "Decide what runs inside the restricted zone — globally and per employee.",
    points: ["Global whitelist that applies to every device",
             "Per-app daily time limits (e.g. YouTube 30 min/day)",
             "Feature keys that unlock time limits per employee"],
  },
  qr: {
    desc: "The physical presence check — manage the QR code posted at the zone entrance.",
    points: ["Live QR display: static (printable) or rotating TOTP (30 s)",
             "Switch modes and rotate the secret instantly",
             "A scan marks the device QR-verified and starts its zone clock"],
  },
  enroll: {
    desc: "Bring devices in and take them out — the BYOD lifecycle in four steps.",
    points: ["Step-by-step enrollment walkthrough (no factory reset)",
             "Devices bind to their first owner — anti-theft by design",
             "Unenroll to release a device for re-registration"],
  },
  users: {
    desc: "Who can open this console, and what they're allowed to touch.",
    points: ["Three access groups: admin, manager, viewer (read-only)",
             "Create accounts, change roles, disable, reset passwords",
             "Roles live in the database and are enforced by the server"],
  },
  settings: {
    desc: "The system's foundations — change with care, devices re-sync within ~10 s.",
    points: ["Geofence polygon editor with a live shape preview",
             "Device admin password (vault unlock / unfreeze)",
             "Which backend this console connects to"],
  },
};

// ═══════════ ICONS ═══════════
const IC = {
  grid:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
  phone:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
  chart:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>',
  sliders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  qr:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M17 17l4 4"/></svg>',
  plus:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/></svg>',
  users:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  gear:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  lock:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  x:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  zone:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  login:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
  home:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z"/><polyline points="9 21.5 9 13 15 13 15 21.5"/></svg>',
  sun:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  arrow:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
};

// ═══════════ HELPERS ═══════════
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 15) return "just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function msHuman(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}

function toast(msg, type = "ok") {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast glass ${type}`;
  el.innerHTML = `<span style="color:${type === "err" ? "var(--bad-text)" : "var(--good-text)"};width:16px;height:16px;flex:none">${type === "err" ? IC.x : IC.check}</span>${esc(msg)}`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 3800);
}

function openModal(html) {
  $("#modalBox").innerHTML = html;
  $("#modalBg").classList.add("on");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("#modalBg").classList.remove("on");
  document.body.style.overflow = "";
}
$("#modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ═══════════ THEME (dark aurora ⇆ light website look) ═══════════
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("eg_theme", t);
  $$(".theme-btn").forEach((b) => { b.innerHTML = t === "light" ? IC.moon : IC.sun; });
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  // charts read theme colors at draw time — re-render the current page
  if (session && currentPage) navigate(currentPage);
}
applyTheme(localStorage.getItem("eg_theme") || "dark");
$("#themeBtn")?.addEventListener("click", toggleTheme);
$("#themeFloat")?.addEventListener("click", toggleTheme);

// ═══════════ PAGINATION (keeps the UI fast at 1000+ rows) ═══════════
function pagerHtml(total, page, per) {
  if (total <= per) return "";
  const from = (page - 1) * per + 1, to = Math.min(total, page * per);
  const last = Math.ceil(total / per);
  return `<div class="pager"><span class="pg-info">${from}–${to} of ${total}</span>
    <button class="btn btn-ghost btn-sm" data-pg="${page - 1}" ${page === 1 ? "disabled" : ""}>‹ Prev</button>
    <span>${page} / ${last}</span>
    <button class="btn btn-ghost btn-sm" data-pg="${page + 1}" ${page === last ? "disabled" : ""}>Next ›</button>
  </div>`;
}
function bindPager(root, cb) {
  $$("[data-pg]", root).forEach((b) => b.addEventListener("click", () => cb(parseInt(b.dataset.pg, 10))));
}
function debounce(fn, ms = 220) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// staggered reveal of .rv elements
function reveal(root = document) {
  $$(".rv", root).forEach((el, i) => {
    setTimeout(() => el.classList.add("in"), reduceMotion ? 0 : 45 * i);
  });
}
// animated count-up for KPI values
function countUp(el, target, suffix = "") {
  if (reduceMotion || target === 0) { el.textContent = target + suffix; return; }
  const dur = 800, t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function progress(p) { $("#progress").style.width = (p * 100) + "%"; if (p >= 1) setTimeout(() => { $("#progress").style.width = "0"; }, 400); }

// ═══════════ API CLIENT ═══════════
async function api(path, opts = {}) {
  const base = apiBase();
  if (!base) throw new Error("No API base URL configured");
  progress(0.35);
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (session?.token) headers["Authorization"] = "Bearer " + session.token;
  let res;
  try {
    res = await fetch(base + path, { ...opts, headers });
  } catch (e) {
    progress(1);
    throw new Error("Cannot reach server — check the API base URL / your connection");
  }
  progress(1);
  if (res.status === 401 && session) { logout("Session expired — please sign in again"); throw new Error("Session expired"); }
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok || body.success === false) throw new Error(body.error || body.message || `HTTP ${res.status}`);
  return body;
}

// ═══════════ AUTH ═══════════
function saveSession() { sessionStorage.setItem("eg_session", JSON.stringify(session)); }
function logout(msg) {
  session = null;
  sessionStorage.removeItem("eg_session");
  clearTimers();
  $("#shell").classList.remove("on");
  $("#loginView").style.display = "flex";
  $("#themeFloat").style.display = "";
  if (msg) { const e = $("#loginErr"); e.textContent = msg; e.classList.add("show"); }
  location.hash = "";
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#loginBtn"), err = $("#loginErr");
  err.classList.remove("show");
  const apiOverride = $("#fApi").value.trim();
  if (apiOverride) localStorage.setItem("eg_api_base", apiOverride);
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const body = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        org_name: $("#fOrg").value.trim(),
        username: $("#fUser").value.trim(),
        password: $("#fPass").value,
      }),
    });
    session = { token: body.token, user: body.user };
    saveSession();
    enterShell();
  } catch (ex) {
    err.textContent = ex.message; err.classList.add("show");
  } finally {
    btn.disabled = false; btn.textContent = "Sign in securely";
  }
});

$("#logoutBtn").addEventListener("click", () => logout());

// ═══════════ SHELL / NAV / ROUTER ═══════════
function enterShell() {
  $("#loginView").style.display = "none";
  $("#themeFloat").style.display = "none"; // the shell has its own toggle in the top bar
  const shell = $("#shell");
  shell.classList.add("on");
  const u = session.user;
  $("#uName").textContent = u.fullName || u.username;
  $("#uRole").textContent = u.role;
  $("#uAvatar").textContent = (u.fullName || u.username).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  buildNav();
  const target = location.hash.replace("#/", "") || "home";
  navigate(allowed(target) ? target : "home");
}

function allowed(id) {
  const p = PAGES.find((p) => p.id === id);
  return p && p.roles.includes(role());
}

function buildNav() {
  const nav = $("#nav");
  let html = "";
  for (let i = 0; i < PAGES.length; i++) {
    const p = PAGES[i];
    if (p.sec) {
      // show a section header only if at least one page under it is allowed
      let any = false;
      for (let j = i + 1; j < PAGES.length && !PAGES[j].sec; j++) if (PAGES[j].roles.includes(role())) any = true;
      if (any) html += `<div class="nav-sec">${p.sec}</div>`;
    } else if (p.roles.includes(role())) {
      html += `<button class="nav-item" data-page="${p.id}"><span style="width:19px;height:19px;display:inline-flex">${IC[p.icon]}</span>${p.title}</button>`;
    }
  }
  nav.innerHTML = html;
  $$(".nav-item", nav).forEach((b) => b.addEventListener("click", () => { navigate(b.dataset.page); closeSidebar(); }));
}

function clearTimers() { pageTimers.forEach(clearInterval); pageTimers = []; }
function every(ms, fn) { pageTimers.push(setInterval(fn, ms)); }

function navigate(id) {
  if (!allowed(id)) id = "home";
  clearTimers();
  currentPage = id;
  location.hash = "/" + id;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  $("#pageTitle").textContent = PAGES.find((p) => p.id === id)?.title || id;
  const view = $("#view");
  view.innerHTML = `<div class="page"><div class="skel" style="height:120px;margin-bottom:18px"></div><div class="skel" style="height:320px"></div></div>`;
  RENDER[id]?.(view).catch((e) => {
    view.innerHTML = `<div class="page"><div class="glass card empty">${IC.x}<div><b>Could not load this page</b><br>${esc(e.message)}</div></div></div>`;
  });
}
window.addEventListener("hashchange", () => {
  const id = location.hash.replace("#/", "");
  if (session && id && id !== currentPage) navigate(id);
});
$("#refreshBtn").addEventListener("click", () => currentPage && navigate(currentPage));

// mobile sidebar
const closeSidebar = () => { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("on"); };
$("#menuBtn").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("on"); });
$("#scrim").addEventListener("click", closeSidebar);

// ═══════════ SHARED FRAGMENTS ═══════════
const meterClass = (s) => s >= 80 ? "m-good" : s >= 50 ? "m-warn" : "m-bad";
const onlineBadge = (a) => a.is_online
  ? `<span class="badge badge-good"><span class="dot"></span>Online</span>`
  : `<span class="badge badge-muted"><span class="dot"></span>Offline</span>`;
const zoneBadge = (a) => a.in_zone
  ? `<span class="badge badge-bad"><span class="dot"></span>In zone</span>`
  : `<span class="badge badge-info"><span class="dot"></span>Safe zone</span>`;
const lockBadge = (a) => (a.admin_lock || a.auto_lock)
  ? `<span class="badge badge-warn"><span class="dot"></span>${a.admin_lock ? "Admin lock" : "Auto lock"}</span>` : "";

function kpiTile({ label, value, sub, icon, tone, suffix }) {
  return `<div class="kpi neo hover-lift rv">
    <div class="k-ic" style="color:${tone || "var(--accent)"}">${IC[icon]}</div>
    <div class="k-label">${label}</div>
    <div class="k-value" data-count="${value}" data-suffix="${suffix || ""}">0</div>
    <div class="k-sub">${sub || ""}</div>
  </div>`;
}
function runCounters(root) {
  $$("[data-count]", root).forEach((el) => countUp(el, parseInt(el.dataset.count, 10) || 0, el.dataset.suffix || ""));
}

function deviceCard(a) {
  return `<div class="dev-card neo hover-lift rv" data-emp="${esc(a.emp_id)}">
    ${(a.admin_lock || a.auto_lock) ? `<span class="lock-overlay" style="color:var(--warn-text);width:16px;height:16px;display:inline-flex">${IC.lock}</span>` : ""}
    <div class="dev-head">
      <div class="dev-ic" style="color:${a.is_online ? "var(--good-text)" : "var(--faint)"}">${IC.phone}</div>
      <div class="dn"><b>${esc(a.emp_name)}</b><span>${esc(a.emp_id)} · ${esc(a.device_model || "unknown")}</span></div>
    </div>
    <div class="dev-tags">${onlineBadge(a)}${zoneBadge(a)}${lockBadge(a)}</div>
    <div class="meter ${meterClass(a.compliance_score)}"><i style="width:0" data-w="${a.compliance_score}"></i></div>
    <div class="dev-meta"><span>Compliance ${a.compliance_score}%</span><span>Seen ${timeAgo(a.last_seen)}</span></div>
  </div>`;
}
function runMeters(root) {
  requestAnimationFrame(() => $$(".meter i[data-w], .split i[data-w]", root).forEach((el) => { el.style.width = el.dataset.w + "%"; }));
}
function bindDeviceCards(root) {
  $$(".dev-card[data-emp]", root).forEach((c) => c.addEventListener("click", () => openDeviceModal(c.dataset.emp)));
}

// ═══════════ PAGE: HOME (what everything does) ═══════════
const RENDER = {};

RENDER.home = async (view) => {
  const u = session.user;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const sections = PAGES.filter((p) => p.id && p.id !== "home");

  view.innerHTML = `<div class="page">
    <div class="glass home-hero rv">
      <div class="hh-ic">${IC.shield}</div>
      <div style="flex:1;min-width:240px">
        <h2>${greet}, ${esc((u.fullName || u.username).split(" ")[0])} 👋</h2>
        <p>This console manages the Env Guardian zero-trust BYOD fleet: devices enforce policy inside the
        restricted zone and report back here in real time. You are signed in as
        <span class="badge role-${u.role}">${u.role}</span> — sections your role can't use are marked below.</p>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap" id="homeStats">
        <div class="neo-in" style="padding:10px 18px;text-align:center;min-width:92px">
          <div style="font-size:22px;font-weight:700;font-family:Outfit" id="hsDev">–</div>
          <div style="font-size:11px;color:var(--muted)">devices</div></div>
        <div class="neo-in" style="padding:10px 18px;text-align:center;min-width:92px">
          <div style="font-size:22px;font-weight:700;font-family:Outfit;color:var(--good-text)" id="hsOn">–</div>
          <div style="font-size:11px;color:var(--muted)">online</div></div>
        <div class="neo-in" style="padding:10px 18px;text-align:center;min-width:92px">
          <div style="font-size:22px;font-weight:700;font-family:Outfit" id="hsComp">–</div>
          <div style="font-size:11px;color:var(--muted)">compliant</div></div>
      </div>
    </div>

    <div class="sect-h"><div><h3>What each section does</h3>
      <p>Click a card to open it. Availability follows your access group.</p></div></div>
    <div class="grid g-home">
      ${sections.map((p) => {
        const ok = p.roles.includes(u.role);
        const info = PAGE_INFO[p.id] || { desc: "", points: [] };
        return `<div class="home-card glass ${ok ? "hover-lift" : "locked"} rv" ${ok ? `data-go="${p.id}"` : ""}>
          <div class="hc-top"><div class="hc-ic">${IC[p.icon]}</div><h3>${p.title}</h3>
            ${ok ? "" : `<span style="width:16px;height:16px;color:var(--faint);display:inline-flex" title="Not available to your role">${IC.lock}</span>`}</div>
          <p>${info.desc}</p>
          <ul>${info.points.map((pt) => `<li>${pt}</li>`).join("")}</ul>
          <div class="hc-foot">
            ${p.roles.map((r) => `<span class="badge role-${r}">${r}</span>`).join("")}
            ${ok ? `<span class="go">Open ${IC.arrow}</span>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
  reveal(view);
  $$("[data-go]", view).forEach((c) => c.addEventListener("click", () => navigate(c.dataset.go)));

  // fill the live mini-stats quietly (aggregates only — cheap even at 1000+ devices)
  api("/api/dashboard/metrics").then((m) => {
    const set = (id, v) => { const el = $(id); if (el) countUp(el, v); };
    set("#hsDev", m.devices.total); set("#hsOn", m.devices.online); set("#hsComp", m.devices.compliant);
  }).catch(() => {});
};

// ═══════════ PAGE: OVERVIEW ═══════════

// Overview shows the devices that most need attention, not the whole fleet —
// locked > non-compliant > in-zone first; the Devices page holds the full list.
const FLEET_CAP = 24;
const attention = (a) => (a.admin_lock || a.auto_lock ? 4 : 0) + (a.policy_status !== "PASS" ? 2 : 0) + (a.in_zone ? 1 : 0);
const fleetSubset = (agents) =>
  [...agents].sort((x, y) => attention(y) - attention(x) || (y.last_seen || 0) - (x.last_seen || 0)).slice(0, FLEET_CAP);

RENDER.overview = async (view) => {
  const [{ agents }, m] = await Promise.all([
    api("/api/dashboard/agents"),
    api("/api/dashboard/metrics").catch(() => null),
  ]);
  const total = agents.length;
  const online = agents.filter((a) => a.is_online).length;
  const inZone = agents.filter((a) => a.in_zone).length;
  const compliant = agents.filter((a) => a.policy_status === "PASS").length;
  const rate = total ? Math.round((compliant / total) * 100) : 100;
  const shown = fleetSubset(agents);

  view.innerHTML = `<div class="page">
    <div class="grid g-kpi">
      ${kpiTile({ label: "Enrolled devices", value: total, icon: "phone", sub: `${online} online now` })}
      ${kpiTile({ label: "Online", value: online, icon: "check", tone: "var(--good-text)", sub: `${total - online} offline` })}
      ${kpiTile({ label: "In restricted zone", value: inZone, icon: "zone", tone: "var(--bad-text)", sub: "enforcement active" })}
      ${kpiTile({ label: "Compliance rate", value: rate, suffix: "%", icon: "shield", tone: rate >= 80 ? "var(--good-text)" : "var(--warn-text)", sub: `${compliant}/${total} compliant` })}
      ${m ? kpiTile({ label: "Logins today", value: m.logins.today, icon: "login", sub: `${m.logins.total} all-time` }) : ""}
    </div>
    <div class="sect-h"><div><h3>Device fleet</h3>
      <p>${total > FLEET_CAP
        ? `Showing the ${FLEET_CAP} devices needing attention first (locked → non-compliant → in-zone) of ${total} total.`
        : "Live status — click a device to manage it."} Refreshes every ${Math.round((CFG.REFRESH_MS || 20000) / 1000)}s.</p></div>
      ${total > FLEET_CAP ? `<button class="btn btn-ghost btn-sm" id="seeAll">View all ${total} in Devices ›</button>` : ""}
    </div>
    <div class="grid g-cards" id="fleet">
      ${total ? shown.map(deviceCard).join("") : `<div class="glass card empty" style="grid-column:1/-1">${IC.phone}<div>No devices enrolled yet.<br>Install the Env Guardian app on a device and complete setup.</div></div>`}
    </div>
  </div>`;
  runCounters(view); runMeters(view); reveal(view); bindDeviceCards(view);
  $("#seeAll")?.addEventListener("click", () => navigate("devices"));

  every(CFG.REFRESH_MS || 20000, async () => {
    try {
      const { agents: fresh } = await api("/api/dashboard/agents");
      const fleet = $("#fleet"); if (!fleet) return;
      fleet.innerHTML = fresh.length ? fleetSubset(fresh).map(deviceCard).join("") : fleet.innerHTML;
      $$(".rv", fleet).forEach((el) => el.classList.add("in"));
      runMeters(fleet); bindDeviceCards(fleet);
    } catch {}
  });
};

// ═══════════ PAGE: DEVICES ═══════════
RENDER.devices = async (view) => {
  const { agents } = await api("/api/dashboard/agents");
  const rows = (list) => list.map((a) => `
    <tr data-emp="${esc(a.emp_id)}" style="cursor:pointer">
      <td><b>${esc(a.emp_name)}</b><br><span class="mono">${esc(a.emp_id)}</span></td>
      <td>${esc(a.device_model || "—")}<br><span class="mono">Android ${esc(a.android_version || "?")} · SDK ${a.sdk_int ?? "?"}</span></td>
      <td>${onlineBadge(a)}</td>
      <td>${zoneBadge(a)}</td>
      <td style="min-width:130px"><div class="meter ${meterClass(a.compliance_score)}"><i style="width:0" data-w="${a.compliance_score}"></i></div>
          <small style="color:var(--faint)">${a.compliance_score}% · ${a.policy_status}</small></td>
      <td>${lockBadge(a) || '<span style="color:var(--faint)">—</span>'}</td>
      <td class="num" style="color:var(--muted)">${timeAgo(a.last_seen)}</td>
    </tr>`).join("");

  const PER = 50;
  let page = 1;

  view.innerHTML = `<div class="page">
    <div class="glass card rv" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <input class="input" id="devSearch" placeholder="Search name, ID or model…" style="max-width:320px" />
      <select class="input" id="devFilter" style="max-width:180px">
        <option value="">All devices</option><option value="online">Online</option>
        <option value="inzone">In zone</option><option value="locked">Locked</option>
        <option value="noncompliant">Non-compliant</option>
      </select>
      <span style="margin-left:auto;color:var(--muted);font-size:13px" id="devCount"></span>
    </div>
    <div class="glass tbl-wrap rv" style="margin-top:16px">
      <table class="tbl"><thead><tr>
        <th>Employee</th><th>Device</th><th>Status</th><th>Zone</th><th>Compliance</th><th>Lock</th><th>Last seen</th>
      </tr></thead><tbody id="devBody"></tbody></table>
      <div id="devPager"></div>
      ${agents.length ? "" : `<div class="empty">${IC.phone}<div>No devices enrolled.</div></div>`}
    </div>
  </div>`;
  reveal(view);

  const filtered = () => {
    const q = $("#devSearch").value.toLowerCase(), f = $("#devFilter").value;
    return agents.filter((a) => {
      if (q && !`${a.emp_name} ${a.emp_id} ${a.device_model}`.toLowerCase().includes(q)) return false;
      if (f === "online" && !a.is_online) return false;
      if (f === "inzone" && !a.in_zone) return false;
      if (f === "locked" && !(a.admin_lock || a.auto_lock)) return false;
      if (f === "noncompliant" && a.policy_status === "PASS") return false;
      return true;
    });
  };
  const draw = () => {
    const list = filtered();
    const last = Math.max(1, Math.ceil(list.length / PER));
    if (page > last) page = last;
    $("#devBody").innerHTML = rows(list.slice((page - 1) * PER, page * PER));
    $("#devPager").innerHTML = pagerHtml(list.length, page, PER);
    $("#devCount").textContent = `${list.length} of ${agents.length} device${agents.length === 1 ? "" : "s"}`;
    runMeters($("#devBody"));
    $$("#devBody tr").forEach((tr) => tr.addEventListener("click", () => openDeviceModal(tr.dataset.emp)));
    bindPager($("#devPager"), (p) => { page = p; draw(); });
  };
  draw();
  $("#devSearch").addEventListener("input", debounce(() => { page = 1; draw(); }));
  $("#devFilter").addEventListener("change", () => { page = 1; draw(); });
};

// ═══════════ DEVICE MODAL (per-device admin) ═══════════
const CHECK_LABELS = { notif: "Notifications", loc: "Location", gps: "GPS", batt: "Battery", overlay: "Overlay", cam: "Camera", access: "Accessibility", usage: "Usage access", qr_verified: "QR verified" };

async function openDeviceModal(empId) {
  openModal(`<div class="skel" style="height:280px"></div>`);
  let a, usage = {};
  try {
    ({ agent: a } = await api(`/api/dashboard/agents/${encodeURIComponent(empId)}`));
    const today = new Date().toISOString().slice(0, 10);
    const u = await api(`/api/app-usage/${encodeURIComponent(empId)}?startDate=${today}&endDate=${today}`).catch(() => null);
    usage = u?.data?.[today] || [];
  } catch (e) { openModal(`<div class="empty">${IC.x}<div>${esc(e.message)}</div></div>`); return; }

  const comp = typeof a.compliance_status === "string" ? JSON.parse(a.compliance_status || "{}") : (a.compliance_status || {});
  const wl = Array.isArray(a.custom_whitelist) ? a.custom_whitelist : [];

  openModal(`
    <div class="modal-head">
      <div class="dev-ic" style="color:${a.is_online ? "var(--good-text)" : "var(--faint)"}">${IC.phone}</div>
      <div style="flex:1"><h3>${esc(a.emp_name)}</h3>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">${onlineBadge(a)}${zoneBadge(a)}${lockBadge(a)}
        <span class="badge ${a.policy_status === "PASS" ? "badge-good" : "badge-bad"}"><span class="dot"></span>${a.compliance_score}% compliant</span></div>
      </div>
      <button class="modal-x" id="mClose">×</button>
    </div>

    <div class="info-grid">
      <div class="ig neo-in"><small>Employee ID</small><span class="mono">${esc(a.emp_id)}</span></div>
      <div class="ig neo-in"><small>Model</small><span>${esc(a.device_model || "—")}</span></div>
      <div class="ig neo-in"><small>Android</small><span>${esc(a.android_version || "?")} (SDK ${a.sdk_int ?? "?"})</span></div>
      <div class="ig neo-in"><small>Last seen</small><span>${timeAgo(a.last_seen)}</span></div>
      <div class="ig neo-in"><small>Enforcer</small><span>${a.enforcer_active ? "Active" : "Inactive"}</span></div>
      <div class="ig neo-in"><small>Registered</small><span>${a.registered_at ? new Date(+a.registered_at).toLocaleDateString() : "—"}</span></div>
    </div>

    <div class="m-sec"><h4>Compliance matrix</h4>
      <div class="cm-grid">${Object.keys(CHECK_LABELS).filter((k) => k in comp).map((k) =>
        `<div class="cm ${comp[k] ? "ok" : "no"}">${comp[k] ? IC.check : IC.x}${CHECK_LABELS[k]}</div>`).join("") || '<span class="hint">No compliance data reported yet.</span>'}
      </div>
    </div>

    ${can("lock") ? `<div class="m-sec"><h4>Remote lock</h4>
      <div style="display:flex;align-items:center;gap:14px">
        <label class="switch"><input type="checkbox" id="mLock" ${a.admin_lock ? "checked" : ""}><span class="tr"></span></label>
        <span style="font-size:13.5px;color:var(--muted)">Admin lock ("banishment") — freezes the device until unlocked${a.auto_lock ? ' · <b style="color:var(--warn-text)">auto-lock tripped</b>' : ""}</span>
      </div></div>` : ""}

    <div class="m-sec"><h4>Per-device whitelist ${can("whitelist") ? "" : "(read-only)"}</h4>
      <div class="chips" id="mChips">${wl.map((p) => `<span class="chip">${esc(p)}${can("whitelist") ? `<button data-pkg="${esc(p)}" title="Remove">×</button>` : ""}</span>`).join("") || '<span class="hint">No per-device apps — the global whitelist still applies.</span>'}</div>
      ${can("whitelist") ? `<div class="input-row" style="margin-top:11px">
        <input class="input" id="mPkg" placeholder="com.example.app" />
        <button class="btn btn-ghost btn-sm" id="mAddPkg">Add</button>
        <button class="btn btn-primary btn-sm" id="mSaveWl">Save whitelist</button>
      </div>` : ""}
    </div>

    <div class="m-sec"><h4>App usage today</h4>
      ${usage.length ? `<div class="chips">${usage.slice(0, 8).map((u) => `<span class="chip">${esc(u.package)} · ${msHuman(u.totalMs)}</span>`).join("")}</div>` : '<span class="hint">No usage reported today.</span>'}
    </div>

    <div class="m-sec" style="display:flex;gap:10px;flex-wrap:wrap">
      ${can("policy") ? `<button class="btn btn-ghost btn-sm" id="mPolicies">Open in Policy Controller →</button>` : ""}
      ${can("unenroll") ? `<button class="btn btn-danger btn-sm" id="mUnenroll">Unenroll device</button>` : ""}
    </div>
  `);

  $("#mClose").addEventListener("click", closeModal);

  $("#mLock")?.addEventListener("change", async (e) => {
    try {
      await api("/api/dashboard/toggle-lock", { method: "POST", body: JSON.stringify({ empId, lockStatus: e.target.checked }) });
      toast(`Device ${e.target.checked ? "locked" : "unlocked"}`);
    } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message, "err"); }
  });

  let wlLocal = [...wl];
  const redrawChips = () => {
    $("#mChips").innerHTML = wlLocal.map((p) => `<span class="chip">${esc(p)}<button data-pkg="${esc(p)}" title="Remove">×</button></span>`).join("") || '<span class="hint">Empty — global whitelist still applies.</span>';
    $$("#mChips button").forEach((b) => b.addEventListener("click", () => { wlLocal = wlLocal.filter((p) => p !== b.dataset.pkg); redrawChips(); }));
  };
  if (can("whitelist")) {
    redrawChips();
    $("#mAddPkg").addEventListener("click", () => {
      const v = $("#mPkg").value.trim();
      if (v && !wlLocal.includes(v)) { wlLocal.push(v); $("#mPkg").value = ""; redrawChips(); }
    });
    $("#mSaveWl").addEventListener("click", async () => {
      try {
        await api("/api/dashboard/update-whitelist", { method: "POST", body: JSON.stringify({ empId, whitelist: wlLocal }) });
        toast("Whitelist saved — devices pick it up within ~10s");
      } catch (ex) { toast(ex.message, "err"); }
    });
  }

  $("#mPolicies")?.addEventListener("click", () => { closeModal(); sessionStorage.setItem("eg_policy_emp", empId); navigate("policies"); });
  $("#mUnenroll")?.addEventListener("click", async () => {
    if (!confirm(`Unenroll ${empId}? This deletes the device, its policies and usage history. The employee can then re-register the device.`)) return;
    try {
      await api(`/api/dashboard/agents/${encodeURIComponent(empId)}`, { method: "DELETE" });
      toast(`${empId} unenrolled`); closeModal(); navigate(currentPage);
    } catch (ex) { toast(ex.message, "err"); }
  });
}

// ═══════════ PAGE: METRICS ═══════════
RENDER.metrics = async (view) => {
  const m = (await api("/api/dashboard/metrics"));
  const d = m.devices;
  const rate = d.total ? Math.round((d.compliant / d.total) * 100) : 100;
  const compPct = d.total ? (d.compliant / d.total) * 100 : 100;

  view.innerHTML = `<div class="page">
    <div class="grid g-2">
      <div class="glass card rv hero-fig">
        <span class="hl">Fleet compliance rate</span>
        <span class="hv ${rate >= 80 ? "k-good" : "k-warn"}" data-count="${rate}" data-suffix="%">0%</span>
        <span class="hl" style="color:var(--faint)">${d.compliant} of ${d.total} devices pass the 7-check policy (≥${CFG.COMPLIANT_AT || 80}%)</span>
        <div style="margin-top:16px">
          <div class="split">
            <i class="sa" style="width:0" data-w="${compPct}"></i>
            <i class="sb" style="width:0" data-w="${100 - compPct}"></i>
          </div>
          <div class="legend">
            <span class="lg"><span class="sw" style="background:var(--good)"></span>Compliant · ${d.compliant}</span>
            <span class="lg"><span class="sw" style="background:var(--bad)"></span>Non-compliant · ${d.non_compliant}</span>
          </div>
        </div>
      </div>
      <div class="grid g-kpi" style="align-content:start">
        ${kpiTile({ label: "Devices", value: d.total, icon: "phone", sub: `${d.locked} locked` })}
        ${kpiTile({ label: "Online now", value: d.online, icon: "check", tone: "var(--good-text)", sub: `${d.offline} offline` })}
        ${kpiTile({ label: "In restricted zone", value: d.in_zone, icon: "zone", tone: "var(--bad-text)", sub: "enforcing now" })}
        ${kpiTile({ label: "Logins today", value: m.logins.today, icon: "login", sub: `${m.logins.total} all-time` })}
      </div>
    </div>

    <div class="grid g-2" style="margin-top:18px">
      <div class="glass viz rv">
        <h3>Console logins</h3><p class="viz-sub">Dashboard sign-ins per day — last 14 days</p>
        <div class="viz-plot" id="vzLogins"></div>
      </div>
      <div class="glass viz rv">
        <h3>Top apps today</h3><p class="viz-sub">Fleet-wide usage inside the zone (from device Usage Access)</p>
        <div class="viz-plot" id="vzApps"></div>
      </div>
    </div>

    <div class="glass viz rv" style="margin-top:18px">
      <h3>Per-device compliance</h3><p class="viz-sub">Worst scores first — across the 7 device checks; ≥${CFG.COMPLIANT_AT || 80}% = compliant</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Device</th><th>Status</th><th style="width:45%">Score</th><th>Zone</th></tr></thead>
      <tbody id="cmpBody"></tbody></table><div id="cmpPager"></div></div>
    </div>
  </div>`;

  runCounters(view); runMeters(view); reveal(view);

  // per-device compliance: worst-first, paginated — stays snappy at 1000+ devices
  const cmpAll = [...m.compliance].sort((a, b) => a.score - b.score);
  const CMP_PER = 25; let cmpPage = 1;
  const drawCmp = () => {
    const body = $("#cmpBody"); if (!body) return;
    body.innerHTML = cmpAll.slice((cmpPage - 1) * CMP_PER, cmpPage * CMP_PER).map((c) => `<tr>
      <td><b>${esc(c.emp_name)}</b> <span class="mono">${esc(c.emp_id)}</span></td>
      <td>${c.status === "PASS" ? '<span class="badge badge-good"><span class="dot"></span>Compliant</span>' : '<span class="badge badge-bad"><span class="dot"></span>Non-compliant</span>'}</td>
      <td><div class="meter ${meterClass(c.score)}"><i style="width:0" data-w="${c.score}"></i></div><small style="color:var(--faint)">${c.score}%</small></td>
      <td>${c.in_zone ? '<span class="badge badge-bad"><span class="dot"></span>In zone</span>' : '<span class="badge badge-info"><span class="dot"></span>Safe</span>'}</td>
    </tr>`).join("") || `<tr><td colspan="4"><div class="empty">No devices yet.</div></td></tr>`;
    $("#cmpPager").innerHTML = pagerHtml(cmpAll.length, cmpPage, CMP_PER);
    runMeters(body);
    bindPager($("#cmpPager"), (p) => { cmpPage = p; drawCmp(); });
  };
  drawCmp();

  EGCharts.column($("#vzLogins"), m.logins.series.map((s) => ({
    label: s.date.slice(5),
    value: s.count,
    tip: `<b>${s.date}</b>${s.count} login${s.count === 1 ? "" : "s"}`,
  })), { label: "Console logins per day" });

  if (m.top_apps.length) {
    EGCharts.hbars($("#vzApps"), m.top_apps.map((t) => ({
      label: t.package.split(".").pop(),
      value: t.total_ms,
      display: msHuman(t.total_ms),
      tip: `<b>${esc(t.package)}</b>${msHuman(t.total_ms)} across ${t.devices} device${t.devices === 1 ? "" : "s"}`,
    })), { label: "Top apps used today" });
  } else {
    $("#vzApps").innerHTML = `<div class="empty">${IC.chart}<div>No usage reported today.</div></div>`;
  }

  // metrics re-renders fully (charts included) — refresh less aggressively
  every(60000, () => { if (currentPage === "metrics") navigate("metrics"); });
};

// ═══════════ PAGE: POLICY CONTROLLER ═══════════
RENDER.policies = async (view) => {
  const [{ settings }, { agents }] = await Promise.all([api("/api/settings"), api("/api/dashboard/agents")]);
  let globalWl = Array.isArray(settings.whitelisted_apps) ? [...settings.whitelisted_apps] : [];
  const preselect = sessionStorage.getItem("eg_policy_emp"); sessionStorage.removeItem("eg_policy_emp");

  view.innerHTML = `<div class="page">
    <div class="glass card rv">
      <div class="sect-h" style="margin:0 0 6px"><div><h3>Global whitelist</h3><p>Apps allowed on <b>every</b> device inside the zone. Devices sync within ~10s.</p></div>
        <button class="btn btn-primary btn-sm" id="gwSave">Save global whitelist</button></div>
      <div class="chips" id="gwChips" style="margin-top:10px"></div>
      <div class="input-row" style="margin-top:12px;max-width:480px">
        <input class="input" id="gwPkg" placeholder="com.example.app (package name)" />
        <button class="btn btn-ghost btn-sm" id="gwAdd">Add</button>
      </div>
      <p class="hint">Common: WhatsApp <code>com.whatsapp</code> · Chrome <code>com.android.chrome</code> · Gmail <code>com.google.android.gm</code> · Teams <code>com.microsoft.teams</code></p>
    </div>

    <div class="glass card rv" style="margin-top:18px">
      <div class="sect-h" style="margin:0 0 14px"><div><h3>Per-device policies</h3><p>Daily time limits + per-app rules for one employee (feature key required on the device).</p></div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;max-width:640px">
        <input class="input" id="polSearch" placeholder="Filter devices by name or ID…" style="max-width:280px" />
        <select class="input" id="polDev" style="flex:1;min-width:240px"></select>
      </div>
      <div id="polBody" style="margin-top:16px"><p class="hint">Choose a device to view or edit its app policies.</p></div>
    </div>
  </div>`;
  reveal(view);

  // ── global whitelist editor ──
  const drawGw = () => {
    $("#gwChips").innerHTML = globalWl.map((p) => `<span class="chip">${esc(p)}<button data-pkg="${esc(p)}">×</button></span>`).join("") || '<span class="hint">Whitelist is empty — every app is blocked in the zone.</span>';
    $$("#gwChips button").forEach((b) => b.addEventListener("click", () => { globalWl = globalWl.filter((p) => p !== b.dataset.pkg); drawGw(); }));
  };
  drawGw();
  $("#gwAdd").addEventListener("click", () => {
    const v = $("#gwPkg").value.trim();
    if (v && !globalWl.includes(v)) { globalWl.push(v); $("#gwPkg").value = ""; drawGw(); }
  });
  $("#gwPkg").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#gwAdd").click(); } });
  $("#gwSave").addEventListener("click", async () => {
    try {
      await api("/api/settings/whitelisted-apps", { method: "PUT", body: JSON.stringify({ apps: globalWl }) });
      toast("Global whitelist saved");
    } catch (ex) { toast(ex.message, "err"); }
  });

  // ── per-device policies ──
  async function loadPolicies(empId) {
    const body = $("#polBody");
    if (!empId) { body.innerHTML = '<p class="hint">Choose a device to view or edit its app policies.</p>'; return; }
    body.innerHTML = `<div class="skel" style="height:160px"></div>`;
    let data;
    try { data = await api(`/api/policies/${encodeURIComponent(empId)}`); }
    catch (e) { body.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
    const flagOn = !!data.feature_flags?.app_time_limits;

    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px" class="neo-in" >
        <div style="display:flex;align-items:center;gap:14px;padding:13px 16px;width:100%">
          <label class="switch"><input type="checkbox" id="ffLimit" ${flagOn ? "checked" : ""}><span class="tr"></span></label>
          <div><b style="font-size:14px">Time-limit feature key</b><br>
          <span style="font-size:12.5px;color:var(--muted)">Unlocks per-app daily budgets on this device (feature_flags.app_time_limits)</span></div>
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Package</th><th>Daily limit</th><th>Allowed</th><th></th></tr></thead>
        <tbody id="polRows">${data.policies.map((p) => `<tr>
          <td class="mono">${esc(p.package)}</td>
          <td class="num">${p.daily_limit_ms > 0 ? msHuman(p.daily_limit_ms) + "/day" : "Unlimited"}</td>
          <td>${p.enabled ? '<span class="badge badge-good"><span class="dot"></span>Allowed</span>' : '<span class="badge badge-bad"><span class="dot"></span>Blocked</span>'}</td>
          <td style="text-align:right"><button class="btn btn-danger btn-sm" data-del="${esc(p.package)}">Remove</button></td>
        </tr>`).join("") || '<tr><td colspan="4"><span class="hint">No app policies yet for this device.</span></td></tr>'}</tbody></table></div>
      <div class="sect-h" style="margin-top:18px"><div><h3 style="font-size:14px">Add / update a policy</h3></div></div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end" class="pol-form">
        <div class="field" style="margin:0"><label>Package</label><input class="input" id="npPkg" placeholder="com.google.android.youtube" /></div>
        <div class="field" style="margin:0"><label>Minutes / day (0 = unlimited)</label><input class="input" id="npMin" type="number" min="0" value="30" /></div>
        <div class="field" style="margin:0"><label>Allowed</label><select class="input" id="npEn"><option value="true">Yes — allowed</option><option value="false">No — always blocked</option></select></div>
        <button class="btn btn-primary" id="npAdd">Apply</button>
      </div>`;

    $("#ffLimit").addEventListener("change", async (e) => {
      try {
        await api(`/api/policies/${encodeURIComponent(empId)}/feature-flags`, {
          method: "PUT",
          body: JSON.stringify({ feature_flags: { ...data.feature_flags, app_time_limits: e.target.checked } }),
        });
        toast(`Time-limit key ${e.target.checked ? "granted" : "revoked"}`);
      } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message, "err"); }
    });
    $$("#polRows [data-del]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await api(`/api/policies/${encodeURIComponent(empId)}/app/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        toast("Policy removed"); loadPolicies(empId);
      } catch (ex) { toast(ex.message, "err"); }
    }));
    $("#npAdd").addEventListener("click", async () => {
      const pkg = $("#npPkg").value.trim();
      if (!pkg) { toast("Package name is required", "err"); return; }
      try {
        await api(`/api/policies/${encodeURIComponent(empId)}/app`, {
          method: "PUT",
          body: JSON.stringify({ package: pkg, daily_limit_ms: (parseInt($("#npMin").value, 10) || 0) * 60000, enabled: $("#npEn").value === "true" }),
        });
        toast("Policy applied"); loadPolicies(empId);
      } catch (ex) { toast(ex.message, "err"); }
    });
  }
  // Device picker stays usable at 1000+ devices: a filter box narrows the
  // <select>, which lists at most 200 matches at a time.
  const POL_CAP = 200;
  const drawPolSelect = () => {
    const q = $("#polSearch").value.toLowerCase();
    const sel = $("#polDev");
    const keep = sel.value || preselect || "";
    const list = agents.filter((a) => !q || `${a.emp_name} ${a.emp_id}`.toLowerCase().includes(q));
    const shown = list.slice(0, POL_CAP);
    sel.innerHTML = `<option value="">Select a device… (${list.length} match${list.length === 1 ? "" : "es"}${list.length > POL_CAP ? `, showing first ${POL_CAP} — refine the filter` : ""})</option>` +
      shown.map((a) => `<option value="${esc(a.emp_id)}" ${a.emp_id === keep ? "selected" : ""}>${esc(a.emp_name)} — ${esc(a.emp_id)}</option>`).join("");
  };
  drawPolSelect();
  $("#polSearch").addEventListener("input", debounce(drawPolSelect));
  $("#polDev").addEventListener("change", (e) => loadPolicies(e.target.value));
  if (preselect) loadPolicies(preselect);
};

// ═══════════ PAGE: QR SETTINGS ═══════════
RENDER.qr = async (view) => {
  const cur = await api("/api/qr-current");
  const manage = can("qrManage");

  view.innerHTML = `<div class="page"><div class="grid g-2">
    <div class="glass rv qr-stage">
      <div style="display:flex;align-items:center;gap:12px">
        <h3 style="font-size:17px">Zone QR code</h3>
        <span class="badge ${cur.mode === "totp" ? "badge-info" : "badge-muted"}"><span class="dot"></span>${cur.mode === "totp" ? "Rotating (TOTP)" : "Static"}</span>
      </div>
      <div class="qr-frame" id="qrFrame"></div>
      <div class="qr-value" id="qrVal"></div>
      <div class="qr-ring" id="qrRing" style="display:${cur.mode === "totp" ? "block" : "none"}">
        <svg width="52" height="52"><circle cx="26" cy="26" r="21" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="4"/>
        <circle id="qrArc" cx="26" cy="26" r="21" fill="none" stroke="#4f6ef7" stroke-width="4" stroke-linecap="round" stroke-dasharray="131.9" stroke-dashoffset="0"/></svg>
        <span class="t" id="qrSecs"></span>
      </div>
      <p class="hint" style="text-align:center;max-width:340px">${cur.mode === "totp"
        ? "The code rotates every 30 seconds — keep this page open on a screen at the zone entrance."
        : "Print this code and post it at the restricted-zone entrance. Employees scan it to verify presence."}</p>
    </div>

    <div style="display:grid;gap:18px;align-content:start">
      <div class="glass card rv">
        <div class="sect-h" style="margin:0 0 12px"><div><h3>QR mode</h3><p>Static printed code, or a rotating time-based code (needs a live display).</p></div></div>
        <div class="seg" id="qrModeSeg">
          <button data-mode="static" class="${cur.mode !== "totp" ? "on" : ""}" ${manage ? "" : "disabled"}>Static</button>
          <button data-mode="totp" class="${cur.mode === "totp" ? "on" : ""}" ${manage ? "" : "disabled"}>Rotating (TOTP)</button>
        </div>
        ${manage ? "" : '<p class="hint">Only admins can change the QR mode.</p>'}
      </div>
      ${manage ? `<div class="glass card rv">
        <div class="sect-h" style="margin:0 0 12px"><div><h3>Rotate the QR secret</h3><p>Invalidates the old code immediately. Re-print / re-display after rotating.</p></div></div>
        <div class="input-row"><input class="input" id="qrNew" placeholder="ZONE-NEW-SECRET-2026" />
        <button class="btn btn-primary btn-sm" id="qrRotate">Rotate</button></div>
      </div>` : ""}
      <div class="glass card rv">
        <div class="sect-h" style="margin:0 0 6px"><div><h3>How it's used</h3></div></div>
        <p style="font-size:13.5px;color:var(--muted);margin:0">When a device enters the restricted zone, the employee must scan this code to verify physical presence. A successful scan marks the device <b>QR-verified</b> and starts its time-in-zone clock. The standalone display page also lives at <code style="background:var(--glass);padding:1px 7px;border-radius:7px">${esc(apiBase())}/qr</code>.</p>
      </div>
    </div>
  </div></div>`;
  reveal(view);

  function drawQr(value) {
    const frame = $("#qrFrame"); if (!frame) return;
    $("#qrVal").textContent = value;
    if (window.qrcode) {
      try {
        const q = window.qrcode(0, "M");
        q.addData(value); q.make();
        frame.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
        return;
      } catch {}
    }
    frame.innerHTML = `<div style="width:232px;height:232px;display:flex;align-items:center;justify-content:center;color:#0a0e1c;font-weight:700;text-align:center;padding:12px">QR library unavailable — use the value below</div>`;
  }
  drawQr(cur.qr_string);

  if (cur.mode === "totp") {
    const period = cur.period || 30;
    let lastStep = Math.floor(Date.now() / 1000 / period);
    every(500, async () => {
      const now = Date.now() / 1000;
      const remain = period - (now % period);
      const arc = $("#qrArc"), secs = $("#qrSecs");
      if (!arc) return;
      arc.style.strokeDashoffset = String(131.9 * (1 - remain / period));
      secs.textContent = Math.ceil(remain);
      const step = Math.floor(now / period);
      if (step !== lastStep) {
        lastStep = step;
        try { const fresh = await api("/api/qr-current"); drawQr(fresh.qr_string); } catch {}
      }
    });
  }

  if (manage) {
    $$("#qrModeSeg button").forEach((b) => b.addEventListener("click", async () => {
      if (b.classList.contains("on")) return;
      try {
        await api("/api/settings/qr-mode", { method: "PUT", body: JSON.stringify({ qr_mode: b.dataset.mode }) });
        toast(`QR mode set to ${b.dataset.mode}`); navigate("qr");
      } catch (ex) { toast(ex.message, "err"); }
    }));
    $("#qrRotate")?.addEventListener("click", async () => {
      const v = $("#qrNew").value.trim();
      if (!v) { toast("Enter a new secret first", "err"); return; }
      if (!confirm("Rotate the QR secret? Every printed/displayed code becomes invalid immediately.")) return;
      try {
        await api("/api/settings/qr-secret", { method: "PUT", body: JSON.stringify({ qr_secret: v }) });
        toast("QR secret rotated"); navigate("qr");
      } catch (ex) { toast(ex.message, "err"); }
    });
  }
};

// ═══════════ PAGE: ENROLLMENT ═══════════
RENDER.enroll = async (view) => {
  const { agents } = await api("/api/dashboard/agents");
  view.innerHTML = `<div class="page">
    <div class="grid g-2">
      <div>
        <div class="sect-h" style="margin-top:0"><div><h3>Enroll a device</h3><p>BYOD-friendly — no factory reset, no Device Owner.</p></div></div>
        <div class="steps">
          ${[
            ["Install the app", 'Distribute the Env Guardian APK (<code>com.envguardian.mdm</code>) to the employee\'s Android phone — direct/private distribution.'],
            ["Grant the required permissions", "First-run setup walks steps 0–9: runtime permissions, Accessibility, the one-time Network Guard (VPN) consent, Usage Access, Notification Access and the OEM auto-start acknowledgement. The device cannot be sealed until all pass."],
            ["Register identity", "The employee enters their <b>name + employee ID</b>. The device registers with the server and is <b>permanently bound to that first owner</b> (anti-theft: a stolen phone can't be re-claimed)."],
            ["Sealed & monitored", "The background monitor starts, the device appears on this dashboard, and heartbeats arrive every ~10 seconds with location, zone state and compliance."],
          ].map(([t, p], i) => `<div class="step glass rv"><div class="sn">${i + 1}</div><div><b>${t}</b><p>${p}</p></div></div>`).join("")}
        </div>
        <div class="glass card rv" style="margin-top:16px">
          <b style="font-size:14px">Re-assigning a device</b>
          <p style="font-size:13.5px;color:var(--muted);margin:6px 0 0">A device is bound to its first owner. To hand it to someone else, <b>unenroll it below</b> (admin only) — the new employee can then register it fresh.</p>
        </div>
      </div>
      <div>
        <div class="sect-h" style="margin-top:0"><div><h3>Enrolled devices</h3><p>${agents.length} device${agents.length === 1 ? "" : "s"} registered${can("unenroll") ? " — unenrolling deletes policies + usage history" : ""}</p></div></div>
        <div class="glass tbl-wrap rv">
          <div style="padding:12px 16px;border-bottom:1px solid var(--grid-line)">
            <input class="input" id="enSearch" placeholder="Search enrolled devices…" style="max-width:280px" />
          </div>
          <table class="tbl" style="min-width:420px"><thead><tr><th>Device</th><th>Status</th><th>Enrolled</th>${can("unenroll") ? "<th></th>" : ""}</tr></thead>
          <tbody id="enBody"></tbody></table><div id="enPager"></div>
        </div>
      </div>
    </div>
  </div>`;
  reveal(view);

  const EN_PER = 25; let enPage = 1;
  const drawEn = () => {
    const q = $("#enSearch").value.toLowerCase();
    const list = agents.filter((a) => !q || `${a.emp_name} ${a.emp_id} ${a.device_model}`.toLowerCase().includes(q));
    const last = Math.max(1, Math.ceil(list.length / EN_PER));
    if (enPage > last) enPage = last;
    $("#enBody").innerHTML = list.slice((enPage - 1) * EN_PER, enPage * EN_PER).map((a) => `<tr>
      <td><b>${esc(a.emp_name)}</b><br><span class="mono">${esc(a.emp_id)} · ${esc(a.device_model || "?")}</span></td>
      <td>${onlineBadge(a)}</td>
      <td class="num" style="color:var(--muted)">${a.registered_at ? new Date(+a.registered_at).toLocaleDateString() : "—"}</td>
      ${can("unenroll") ? `<td style="text-align:right"><button class="btn btn-danger btn-sm" data-un="${esc(a.emp_id)}">Unenroll</button></td>` : ""}
    </tr>`).join("") || `<tr><td colspan="4"><div class="empty">No matching devices.</div></td></tr>`;
    $("#enPager").innerHTML = pagerHtml(list.length, enPage, EN_PER);
    bindPager($("#enPager"), (p) => { enPage = p; drawEn(); });
    $$("#enBody [data-un]").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.un;
      if (!confirm(`Unenroll ${id}? This deletes the device, its policies and usage history so it can be re-registered.`)) return;
      try {
        await api(`/api/dashboard/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast(`${id} unenrolled`); navigate("enroll");
      } catch (ex) { toast(ex.message, "err"); }
    }));
  };
  drawEn();
  $("#enSearch").addEventListener("input", debounce(() => { enPage = 1; drawEn(); }));
};

// ═══════════ PAGE: USERS & ROLES (admin) ═══════════
RENDER.users = async (view) => {
  const { users } = await api("/api/users");
  const roleBadge = (r) => `<span class="badge role-${r}">${r}</span>`;

  view.innerHTML = `<div class="page">
    <div class="glass card rv">
      <div class="sect-h" style="margin:0 0 8px"><div><h3>Dashboard access groups</h3><p>Roles live in the database (<code style="background:var(--glass);padding:1px 6px;border-radius:6px">users.role</code>) and gate both this console and the API.</p></div></div>
      <div class="grid g-3" style="margin-top:10px">
        <div class="neo-in" style="padding:14px 16px">${roleBadge("admin")}<p style="font-size:12.5px;color:var(--muted);margin:8px 0 0">Everything: settings, QR secret & mode, users, unenrollment, geofence, password.</p></div>
        <div class="neo-in" style="padding:14px 16px">${roleBadge("manager")}<p style="font-size:12.5px;color:var(--muted);margin:8px 0 0">Operate: lock/unlock, whitelists, app policies, QR display, enrollment view.</p></div>
        <div class="neo-in" style="padding:14px 16px">${roleBadge("viewer")}<p style="font-size:12.5px;color:var(--muted);margin:8px 0 0">Read-only: overview, devices and metrics. No mutating actions.</p></div>
      </div>
    </div>

    <div class="glass tbl-wrap rv" style="margin-top:18px">
      <div style="padding:14px 16px;border-bottom:1px solid var(--grid-line);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <input class="input" id="usrSearch" placeholder="Search users…" style="max-width:280px" />
        <span style="margin-left:auto;color:var(--muted);font-size:13px" id="usrCount"></span>
      </div>
      <table class="tbl"><thead><tr><th>User</th><th>Role</th><th>Active</th><th>Last login</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody id="usrBody"></tbody></table><div id="usrPager"></div>
    </div>

    <div class="glass card rv" style="margin-top:18px">
      <div class="sect-h" style="margin:0 0 12px"><div><h3>Add a user</h3><p>Creates a console login with the chosen access group.</p></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end">
        <div class="field" style="margin:0"><label>Username</label><input class="input" id="nuUser" /></div>
        <div class="field" style="margin:0"><label>Full name</label><input class="input" id="nuName" /></div>
        <div class="field" style="margin:0"><label>Password</label><input class="input" id="nuPass" type="password" /></div>
        <div class="field" style="margin:0"><label>Role</label><select class="input" id="nuRole">
          <option value="viewer">viewer</option><option value="manager">manager</option><option value="admin">admin</option></select></div>
        <button class="btn btn-primary" id="nuAdd">Create user</button>
      </div>
    </div>
  </div>`;
  reveal(view);

  const USR_PER = 25; let usrPage = 1;
  const usrRow = (u) => `<tr>
    <td><div style="display:flex;gap:11px;align-items:center">
      <div class="avatar" style="width:32px;height:32px;font-size:11.5px">${esc(u.avatar_initials || u.username.slice(0, 2).toUpperCase())}</div>
      <div><b>${esc(u.full_name || u.username)}</b><br><span class="mono">${esc(u.username)}${u.email ? " · " + esc(u.email) : ""}</span></div></div></td>
    <td><select class="input" data-role="${u.id}" style="padding:6px 10px;max-width:120px" ${u.id === session.user.id ? "disabled" : ""}>
      ${["admin", "manager", "viewer"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
    <td><label class="switch"><input type="checkbox" data-active="${u.id}" ${u.is_active ? "checked" : ""} ${u.id === session.user.id ? "disabled" : ""}><span class="tr"></span></label></td>
    <td class="num" style="color:var(--muted)">${u.last_login ? timeAgo(+u.last_login) : "never"}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-ghost btn-sm" data-pw="${u.id}">Reset password</button>
      ${u.id === session.user.id ? "" : `<button class="btn btn-danger btn-sm" data-rm="${u.id}" data-name="${esc(u.username)}">Delete</button>`}
    </td>
  </tr>`;
  const drawUsers = () => {
    const q = $("#usrSearch").value.toLowerCase();
    const list = users.filter((u) => !q || `${u.username} ${u.full_name || ""} ${u.email || ""} ${u.role}`.toLowerCase().includes(q));
    const last = Math.max(1, Math.ceil(list.length / USR_PER));
    if (usrPage > last) usrPage = last;
    const body = $("#usrBody");
    body.innerHTML = list.slice((usrPage - 1) * USR_PER, usrPage * USR_PER).map(usrRow).join("");
    $("#usrPager").innerHTML = pagerHtml(list.length, usrPage, USR_PER);
    $("#usrCount").textContent = `${list.length} of ${users.length} account${users.length === 1 ? "" : "s"}`;
    bindPager($("#usrPager"), (p) => { usrPage = p; drawUsers(); });

    $$("[data-role]", body).forEach((s) => s.addEventListener("change", async () => {
      try { await api(`/api/users/${s.dataset.role}`, { method: "PUT", body: JSON.stringify({ role: s.value }) }); toast("Role updated"); }
      catch (ex) { toast(ex.message, "err"); navigate("users"); }
    }));
    $$("[data-active]", body).forEach((s) => s.addEventListener("change", async () => {
      try { await api(`/api/users/${s.dataset.active}`, { method: "PUT", body: JSON.stringify({ is_active: s.checked }) }); toast(s.checked ? "Account enabled" : "Account disabled"); }
      catch (ex) { s.checked = !s.checked; toast(ex.message, "err"); }
    }));
    $$("[data-pw]", body).forEach((b) => b.addEventListener("click", async () => {
      const pw = prompt("New password (min 6 characters):");
      if (!pw) return;
      try { await api(`/api/users/${b.dataset.pw}`, { method: "PUT", body: JSON.stringify({ password: pw }) }); toast("Password reset"); }
      catch (ex) { toast(ex.message, "err"); }
    }));
    $$("[data-rm]", body).forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Delete user "${b.dataset.name}"? They lose console access immediately.`)) return;
      try { await api(`/api/users/${b.dataset.rm}`, { method: "DELETE" }); toast("User deleted"); navigate("users"); }
      catch (ex) { toast(ex.message, "err"); }
    }));
  };
  drawUsers();
  $("#usrSearch").addEventListener("input", debounce(() => { usrPage = 1; drawUsers(); }));

  $("#nuAdd").addEventListener("click", async () => {
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify({
        username: $("#nuUser").value.trim(), full_name: $("#nuName").value.trim() || undefined,
        password: $("#nuPass").value, role: $("#nuRole").value,
      }) });
      toast("User created"); navigate("users");
    } catch (ex) { toast(ex.message, "err"); }
  });
};

// ═══════════ PAGE: SETTINGS (admin) ═══════════
RENDER.settings = async (view) => {
  const { settings } = await api("/api/settings");
  let poly = Array.isArray(settings.geofence_polygon) ? settings.geofence_polygon.map((p) => ({ ...p })) : [];

  view.innerHTML = `<div class="page">
    <div class="grid g-2">
      <div class="glass card rv">
        <div class="sect-h" style="margin:0 0 12px"><div><h3>Restricted zone (geofence)</h3><p>3+ corner points, in order around the area. Devices re-sync within ~10s.</p></div>
          <button class="btn btn-primary btn-sm" id="gfSave">Save zone</button></div>
        <div id="gfRows"></div>
        <button class="btn btn-ghost btn-sm" id="gfAdd" style="margin-top:10px">+ Add point</button>
      </div>
      <div class="glass card rv">
        <div class="sect-h" style="margin:0 0 12px"><div><h3>Zone preview</h3><p>Shape drawn from the points (not to map scale).</p></div></div>
        <div id="gfPreview"></div>
      </div>
    </div>

    <div class="grid g-2" style="margin-top:18px">
      <div class="glass card rv">
        <div class="sect-h" style="margin:0 0 12px"><div><h3>Admin password</h3><p>Used on the device to unlock the Armory vault and unfreeze a locked phone.</p></div></div>
        <div class="field"><label>Current password</label><input class="input" id="apOld" type="password" /></div>
        <div class="field"><label>New password</label><input class="input" id="apNew" type="password" /></div>
        <button class="btn btn-primary btn-sm" id="apSave">Change password</button>
      </div>
      <div class="glass card rv">
        <div class="sect-h" style="margin:0 0 12px"><div><h3>Console connection</h3><p>Which backend this dashboard talks to (stored in this browser).</p></div></div>
        <div class="field"><label>API base URL</label><input class="input" id="cnUrl" value="${esc(apiBase())}" /></div>
        <button class="btn btn-ghost btn-sm" id="cnSave">Save connection</button>
        <p class="hint">Changing the server signs you out — sessions aren't shared between backends.</p>
      </div>
    </div>
  </div>`;
  reveal(view);

  const drawRows = () => {
    $("#gfRows").innerHTML = poly.map((p, i) => `
      <div class="input-row" style="margin-bottom:8px">
        <span style="width:34px;color:var(--faint);font-size:12px;font-weight:700">P${i + 1}</span>
        <input class="input" data-lat="${i}" type="number" step="0.000001" value="${p.lat}" placeholder="lat" />
        <input class="input" data-lng="${i}" type="number" step="0.000001" value="${p.lng}" placeholder="lng" />
        <button class="btn btn-danger btn-sm btn-icon" data-rm="${i}" title="Remove" ${poly.length <= 3 ? "disabled" : ""}>×</button>
      </div>`).join("");
    EGCharts.polygon($("#gfPreview"), poly);
    $$("#gfRows input").forEach((inp) => inp.addEventListener("input", () => {
      const i = +(inp.dataset.lat ?? inp.dataset.lng);
      if (inp.dataset.lat !== undefined) poly[i].lat = parseFloat(inp.value) || 0;
      else poly[i].lng = parseFloat(inp.value) || 0;
      EGCharts.polygon($("#gfPreview"), poly);
    }));
    $$("#gfRows [data-rm]").forEach((b) => b.addEventListener("click", () => { poly.splice(+b.dataset.rm, 1); drawRows(); }));
  };
  drawRows();
  $("#gfAdd").addEventListener("click", () => {
    const last = poly[poly.length - 1] || { lat: 0, lng: 0 };
    poly.push({ lat: +(last.lat + 0.0005).toFixed(6), lng: +(last.lng + 0.0005).toFixed(6) });
    drawRows();
  });
  $("#gfSave").addEventListener("click", async () => {
    if (poly.length < 3) { toast("A zone needs at least 3 points", "err"); return; }
    try {
      await api("/api/settings/geofence", { method: "PUT", body: JSON.stringify({ polygon: poly }) });
      toast("Geofence saved — devices re-sync within ~10s");
    } catch (ex) { toast(ex.message, "err"); }
  });

  $("#apSave").addEventListener("click", async () => {
    try {
      await api("/api/settings/admin-password", { method: "PUT", body: JSON.stringify({ oldPassword: $("#apOld").value, password: $("#apNew").value }) });
      toast("Admin password changed"); $("#apOld").value = $("#apNew").value = "";
    } catch (ex) { toast(ex.message, "err"); }
  });

  $("#cnSave").addEventListener("click", () => {
    const v = $("#cnUrl").value.trim();
    if (!v) { toast("Enter a URL", "err"); return; }
    localStorage.setItem("eg_api_base", v.replace(/\/+$/, ""));
    toast("Connection saved — signing out");
    setTimeout(() => logout(), 900);
  });
};

// ═══════════ BOOT ═══════════
if (session?.token) {
  // resume the session if the token is still valid
  api("/api/auth/verify", { method: "POST" }).then((r) => {
    if (r.valid) enterShell(); else logout();
  }).catch(() => enterShell()); // offline check failure — try optimistically
} else {
  $("#fApi").value = localStorage.getItem("eg_api_base") || "";
}

})();
