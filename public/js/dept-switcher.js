/**
 * dept-switcher.js
 * Shared department selector for super admin.
 * Injects a department dropdown into the header nav (super admin only).
 * Persists the selected department in localStorage.
 * Exposes window.getAdminDeptId() for use by every admin page.
 */

(function () {
  const LS_KEY = 'adminSelectedDeptId';

  window.getAdminDeptId = function () {
    return parseInt(localStorage.getItem(LS_KEY) || '1', 10);
  };

  window.setAdminDeptId = function (id) {
    localStorage.setItem(LS_KEY, String(parseInt(id, 10)));
  };

  window.initDeptSwitcher = function (user, onChangeCb) {
    if (!user || !user.isSuperAdmin) {
      // Incharge: lock to their own dept — no dropdown
      if (user && user.department_id) {
        window.setAdminDeptId(user.department_id);
      }
      return;
    }

    // Super admin: fetch all departments and inject dropdown
    fetch('/api/admin/departments-list')
      .then(function (r) {
        if (!r.ok) throw new Error('departments-list returned ' + r.status);
        return r.json();
      })
      .then(function (depts) {
        if (!Array.isArray(depts) || !depts.length) return;

        // Ensure stored selection is valid; fall back to first dept
        var currentId = window.getAdminDeptId();
        var valid = depts.some(function (d) { return parseInt(d.id) === currentId; });
        if (!valid) {
          currentId = parseInt(depts[0].id);
          window.setAdminDeptId(currentId);
        }

        // Build the select element
        var sel = document.createElement('select');
        sel.id = 'deptSwitcher';
        sel.title = 'Switch department';
        sel.style.cssText = [
          'background:#ffffff',
          'color:#1a237e',
          'border:2px solid #90caf9',
          'border-radius:6px',
          'padding:5px 10px',
          'font-size:0.82rem',
          'font-weight:700',
          'cursor:pointer',
          'margin-left:12px',
          'outline:none',
          'max-width:230px',
          'min-width:140px'
        ].join(';');

        depts.forEach(function (d) {
          var opt = document.createElement('option');
          opt.value = String(parseInt(d.id));
          opt.textContent = d.name;
          if (parseInt(d.id) === currentId) opt.selected = true;
          sel.appendChild(opt);
        });

        sel.addEventListener('change', function () {
          var newId = parseInt(this.value, 10);
          window.setAdminDeptId(newId);
          if (typeof onChangeCb === 'function') onChangeCb(newId);
        });

        // Label element
        var label = document.createElement('span');
        label.style.cssText = [
          'color:rgba(255,255,255,0.7)',
          'font-size:0.75rem',
          'margin-left:14px',
          'white-space:nowrap',
          'align-self:center'
        ].join(';');
        label.textContent = '🏛️';

        // Insert before Logout button
        var nav = document.querySelector('.header nav');
        if (nav) {
          var logoutBtn = nav.querySelector('.btn-logout');
          if (logoutBtn) {
            nav.insertBefore(sel, logoutBtn);
            nav.insertBefore(label, sel);
          } else {
            nav.appendChild(label);
            nav.appendChild(sel);
          }
        }
      })
      .catch(function (err) {
        console.warn('[dept-switcher] Could not load departments:', err.message || err);
      });
  };
})();
