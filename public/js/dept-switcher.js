/**
 * dept-switcher.js
 * Shared helper for super admin department selection.
 *
 * Usage in every admin page:
 *   1. Include <script src="/js/dept-switcher.js"></script> BEFORE the page script.
 *   2. In the auth callback, call:
 *        await DeptSwitcher.init(d.user, onDeptChange);
 *      where onDeptChange is a function called whenever the dept selection changes.
 *   3. Use DeptSwitcher.deptId instead of your local deptId variable.
 */

const DeptSwitcher = (() => {
  const LS_KEY = 'superAdminSelectedDept';
  let _isSuperAdmin = false;
  let _allDepts = [];
  let _deptId = 1;
  let _onChangeCb = null;

  /** Returns the currently active department id */
  function getDeptId() { return _deptId; }

  /**
   * Call once in the auth callback.
   * @param {object} user  - d.user from /api/auth/status
   * @param {function} cb  - called with no args whenever dept changes (page should reload data)
   */
  async function init(user, cb) {
    _onChangeCb = cb || null;

    if (!user.isSuperAdmin) {
      // Incharge: use their assigned dept, no switcher needed
      _deptId = user.department_id || 1;
      _isSuperAdmin = false;
      return;
    }

    _isSuperAdmin = true;

    // Load all departments from API
    try {
      const res = await fetch('/api/departments');
      _allDepts = res.ok ? await res.json() : [];
    } catch { _allDepts = []; }

    // Restore saved selection, fallback to 1
    const saved = parseInt(localStorage.getItem(LS_KEY) || '1') || 1;
    _deptId = saved;

    // Inject the selector into the header nav
    _renderSelector();
  }

  function _renderSelector() {
    // Find the header nav element — look for the nav inside .header
    const nav = document.querySelector('header.header nav');
    if (!nav) return;

    // Avoid double-inject
    if (document.getElementById('deptSwitcherWrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'deptSwitcherWrap';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-right:8px;';

    const label = document.createElement('span');
    label.textContent = '🏢';
    label.style.cssText = 'color:rgba(255,255,255,0.7);font-size:0.78rem;';

    const sel = document.createElement('select');
    sel.id = 'deptSwitcherSelect';
    sel.style.cssText = [
      'background:rgba(255,255,255,0.15)',
      'color:#fff',
      'border:1px solid rgba(255,255,255,0.35)',
      'border-radius:4px',
      'padding:3px 8px',
      'font-size:0.8rem',
      'cursor:pointer',
      'max-width:200px',
    ].join(';');

    _allDepts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      if (d.id === _deptId) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', () => {
      _deptId = parseInt(sel.value);
      localStorage.setItem(LS_KEY, _deptId);
      if (_onChangeCb) _onChangeCb(_deptId);
    });

    wrap.appendChild(label);
    wrap.appendChild(sel);

    // Insert before the logout button (last button in nav)
    const logoutBtn = nav.querySelector('button.btn-logout');
    if (logoutBtn) nav.insertBefore(wrap, logoutBtn);
    else nav.appendChild(wrap);
  }

  return { init, getDeptId, get deptId() { return _deptId; } };
})();
