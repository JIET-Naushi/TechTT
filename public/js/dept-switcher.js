/**
 * dept-switcher.js
 * Shared department selector for super admin.
 * Injects a department dropdown into the header nav (super admin only).
 * Persists the selected department in localStorage.
 * Exposes window.getAdminDeptId() for use by every admin page.
 */

(function () {
  const LS_KEY = 'adminSelectedDeptId';

  // Returns the currently selected department id (number).
  // Super admin: from localStorage (default 1).
  // Incharge: their own department_id from the auth token.
  window.getAdminDeptId = function () {
    return parseInt(localStorage.getItem(LS_KEY) || '1', 10);
  };

  window.setAdminDeptId = function (id) {
    localStorage.setItem(LS_KEY, String(id));
  };

  /**
   * Call this after auth resolves.
   * @param {object} user  - the user object from /api/auth/status
   * @param {function} onChangeCb - called (with new deptId) when the dept selection changes
   */
  window.initDeptSwitcher = function (user, onChangeCb) {
    if (!user.isSuperAdmin) {
      // Incharge: lock to their own dept, no dropdown needed
      window.setAdminDeptId(user.department_id || 1);
      return;
    }

    // Super admin: inject dropdown into the header nav
    fetch('/api/admin/departments-list')
      .then(r => r.json())
      .then(depts => {
        if (!depts || !depts.length) return;

        // Ensure current selection is valid
        const current = window.getAdminDeptId();
        if (!depts.find(d => d.id === current)) {
          window.setAdminDeptId(depts[0].id);
        }

        const sel = document.createElement('select');
        sel.id = 'deptSwitcher';
        sel.style.cssText = [
          'background:rgba(255,255,255,0.18)',
          'color:#fff',
          'border:1px solid rgba(255,255,255,0.35)',
          'border-radius:6px',
          'padding:5px 10px',
          'font-size:0.82rem',
          'font-weight:600',
          'cursor:pointer',
          'margin-left:16px',
          'outline:none',
          'max-width:220px'
        ].join(';');

        // Style option elements (limited browser support but best-effort)
        depts.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.name;
          if (d.id === window.getAdminDeptId()) opt.selected = true;
          sel.appendChild(opt);
        });

        sel.addEventListener('change', function () {
          window.setAdminDeptId(parseInt(this.value, 10));
          if (typeof onChangeCb === 'function') onChangeCb(parseInt(this.value, 10));
        });

        // Insert before the Logout button in the header nav
        const nav = document.querySelector('.header nav');
        if (nav) {
          const label = document.createElement('span');
          label.style.cssText = 'color:rgba(255,255,255,0.65);font-size:0.75rem;margin-left:16px;white-space:nowrap;';
          label.textContent = '🏛️ Dept:';
          nav.insertBefore(sel, nav.querySelector('.btn-logout'));
          nav.insertBefore(label, sel);
        }
      })
      .catch(() => { /* silently ignore if endpoint not available */ });
  };
})();
