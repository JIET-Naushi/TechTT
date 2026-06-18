/**
 * dept-switcher.js
 * Shared super-admin department switcher.
 *
 * Usage in every admin page:
 *   1. Add <script src="/js/dept-switcher.js"></script> in <head> (before page script).
 *   2. Replace the auth-status fetch with initAdminPage(callback) where callback(deptId, user)
 *      receives the resolved deptId and the authenticated user object.
 *
 * For incharge users the switcher is invisible and deptId always equals their own dept.
 * For super admin a dropdown appears in the header nav listing all departments.
 * The selected department is stored in localStorage so it persists across page navigation.
 */

const DEPT_KEY = 'sa_active_dept_id';

// ── Public helpers ─────────────────────────────────────────────────────────────
function getActiveDeptId() {
  return parseInt(localStorage.getItem(DEPT_KEY) || '1');
}

function setActiveDeptId(id) {
  localStorage.setItem(DEPT_KEY, String(id));
}

/**
 * initAdminPage(onReady)
 *
 * Checks auth, injects the department switcher for super admin,
 * then calls onReady(deptId, user).
 *
 * @param {function(deptId: number, user: object): void} onReady
 * @param {object}  [opts]
 * @param {boolean} [opts.superAdminOnly=false]  Redirect non-super-admins away.
 * @param {string}  [opts.redirectTo='/login.html']  Where to redirect if not logged in.
 */
async function initAdminPage(onReady, opts = {}) {
  const redirectTo = opts.redirectTo || '/login.html';

  let authData;
  try {
    const res = await fetch('/api/auth/status');
    authData = await res.json();
  } catch {
    location.href = redirectTo;
    return;
  }

  if (!authData.loggedIn) { location.href = redirectTo; return; }
  if (opts.superAdminOnly && !authData.user.isSuperAdmin) { location.href = '/admin/dashboard.html'; return; }

  const user = authData.user;

  // ── User badge ──────────────────────────────────────────────────────────────
  const badge = document.getElementById('userBadge');
  if (badge) {
    if (user.loginType === 'google') {
      badge.innerHTML = (user.picture
        ? `<img src="${user.picture}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;">`
        : '') + `<span style="margin-left:4px;">${user.name || user.username}</span>`;
    } else {
      badge.innerHTML = `<span>👤 ${user.username}</span>`;
    }
  }

  // ── Super admin menu ────────────────────────────────────────────────────────
  const saMenu = document.getElementById('superAdminMenu');
  if (saMenu && user.isSuperAdmin) saMenu.style.display = 'block';

  // ── Resolve active department ───────────────────────────────────────────────
  let deptId;
  if (user.isSuperAdmin) {
    // Seed localStorage to dept 1 if never set
    if (!localStorage.getItem(DEPT_KEY)) setActiveDeptId(1);
    deptId = getActiveDeptId();
    await _injectDeptSwitcher(deptId, onReady, opts);
  } else {
    deptId = user.department_id;
    // Update page title for incharge
    const pt = document.getElementById('pageTitle');
    if (pt && user.dept_name && !pt.dataset.noAutoTitle)
      pt.textContent = pt.textContent.replace(/—.*$/, `— ${user.dept_name}`);
    onReady(deptId, user);
  }
}

// ── Private: build and inject the department switcher ─────────────────────────
async function _injectDeptSwitcher(currentDeptId, onReady, opts) {
  // Fetch all departments
  let depts = [];
  try {
    const res = await fetch('/api/admin/departments');
    depts = res.ok ? await res.json() : [];
  } catch { /* silent */ }

  if (!depts.length) {
    // Fallback: just call onReady with current deptId
    onReady(currentDeptId, { isSuperAdmin: true });
    return;
  }

  // Ensure stored deptId is valid; reset to first dept if not
  if (!depts.find(d => d.id === currentDeptId)) {
    currentDeptId = depts[0].id;
    setActiveDeptId(currentDeptId);
  }

  // Build the switcher element
  const wrapper = document.createElement('div');
  wrapper.id = 'deptSwitcherWrapper';
  wrapper.style.cssText = `
    display:inline-flex;align-items:center;gap:6px;
    margin-left:12px;padding:3px 6px 3px 10px;
    background:rgba(255,255,255,0.15);border-radius:6px;
    font-size:0.82rem;
  `;
  wrapper.innerHTML = `
    <span style="color:rgba(255,255,255,0.75);white-space:nowrap;">🏛️ Dept:</span>
    <select id="deptSwitcherSelect"
      style="background:rgba(255,255,255,0.9);color:#1a237e;font-weight:700;
             border:none;border-radius:4px;padding:3px 6px;font-size:0.82rem;cursor:pointer;max-width:200px;">
      ${depts.map(d => `<option value="${d.id}" ${d.id === currentDeptId ? 'selected' : ''}>${d.name}</option>`).join('')}
    </select>
  `;

  // Inject into header nav (before logout button)
  const nav = document.querySelector('header nav') || document.querySelector('.header nav');
  if (nav) {
    const logoutBtn = nav.querySelector('.btn-logout');
    if (logoutBtn) nav.insertBefore(wrapper, logoutBtn);
    else nav.appendChild(wrapper);
  }

  // Wire up change handler — switch dept and reload page
  document.getElementById('deptSwitcherSelect').addEventListener('change', function () {
    const newId = parseInt(this.value);
    setActiveDeptId(newId);
    location.reload();
  });

  // Call onReady with the resolved dept
  onReady(currentDeptId, { isSuperAdmin: true });
}
