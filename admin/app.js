/* ===========================================================================
   Orbit Innovations — admin dashboard
   =========================================================================== */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    page: 1,
    pageSize: 20,
    status: 'all',
    position: 'all',
    search: '',
    from: '',
    to: '',
    total: 0,
    statuses: [],
    applications: []
  };

  var filtersReady = false;

  /* ------------------------------------------------------------- helpers */

  function query() {
    var params = new URLSearchParams();
    params.set('page', state.page);
    params.set('pageSize', state.pageSize);
    if (state.status !== 'all') params.set('status', state.status);
    if (state.position !== 'all') params.set('position', state.position);
    if (state.search) params.set('search', state.search);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    return params;
  }

  function formatDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return iso || '—';
    return date.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function handleAuth(response) {
    if (response.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('unauthenticated');
    }
    return response;
  }

  /* --------------------------------------------------------------- fetch */

  function load() {
    fetch('/admin/api/applications?' + query().toString(), { headers: { Accept: 'application/json' } })
      .then(handleAuth)
      .then(function (response) { return response.json(); })
      .then(function (body) {
        if (!body.ok) return;
        state.applications = body.applications;
        state.total = body.total;
        state.statuses = body.statuses;

        if (!filtersReady) {
          fillSelect($('statusFilter'), body.statuses);
          fillSelect($('positionFilter'), body.positions);
          filtersReady = true;
        }

        renderStats(body.stats);
        renderTable();
        renderPager();
      })
      .catch(function () { /* redirected or offline */ });
  }

  function fillSelect(select, values) {
    values.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
  }

  /* -------------------------------------------------------------- render */

  function renderStats(stats) {
    var container = $('stats');
    container.textContent = '';

    var entries = [{ label: 'All applications', value: stats.total, key: 'all' }];
    Object.keys(stats.counts).forEach(function (status) {
      entries.push({ label: status, value: stats.counts[status], key: status });
    });

    entries.forEach(function (entry) {
      var card = el('button', 'stat');
      card.type = 'button';
      if (state.status === entry.key) card.classList.add('active');
      card.appendChild(el('span', 'stat-value', String(entry.value)));
      card.appendChild(el('span', 'stat-label', entry.label));
      card.addEventListener('click', function () {
        state.status = entry.key;
        state.page = 1;
        $('statusFilter').value = entry.key;
        load();
      });
      container.appendChild(card);
    });
  }

  function renderTable() {
    var body = $('tableBody');
    body.textContent = '';

    $('emptyState').hidden = state.applications.length > 0;
    $('resultCount').textContent = state.total
      ? state.total + (state.total === 1 ? ' application' : ' applications')
      : '';

    state.applications.forEach(function (application) {
      var row = document.createElement('tr');
      row.tabIndex = 0;

      row.appendChild(el('td', 'cell-id', application.applicationId));

      var candidate = el('td', 'cell-name');
      candidate.appendChild(document.createTextNode(application.fullName));
      candidate.appendChild(el('span', 'cell-sub', application.email + ' · ' + application.city));
      row.appendChild(candidate);

      var position = el('td', '', application.position);
      position.appendChild(el('span', 'cell-sub', application.workPreference));
      row.appendChild(position);

      row.appendChild(el('td', '', application.experience));
      row.appendChild(el('td', 'cell-date', formatDate(application.createdAt)));

      var statusCell = el('td');
      statusCell.appendChild(el('span', 'pill pill-' + application.status, application.status));
      row.appendChild(statusCell);

      function open() { openDrawer(application); }
      row.addEventListener('click', open);
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });

      body.appendChild(row);
    });
  }

  function renderPager() {
    var pages = Math.max(Math.ceil(state.total / state.pageSize), 1);
    $('pager').hidden = pages <= 1;
    $('pageInfo').textContent = 'Page ' + state.page + ' of ' + pages;
    $('prevPage').disabled = state.page <= 1;
    $('nextPage').disabled = state.page >= pages;
  }

  /* -------------------------------------------------------------- drawer */

  function detail(label, value, isLink) {
    var wrap = el('div', 'detail');
    wrap.appendChild(el('div', 'detail-label', label));

    var box = el('div', 'detail-value');
    if (!value) {
      box.textContent = '—';
    } else if (isLink) {
      var link = el('a', null, value);
      link.href = value;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      box.appendChild(link);
    } else {
      box.textContent = value;
    }
    wrap.appendChild(box);
    return wrap;
  }

  function openDrawer(application) {
    $('drawerName').textContent = application.fullName;
    $('drawerId').textContent = application.applicationId + ' · ' + formatDate(application.createdAt);

    var body = $('drawerBody');
    body.textContent = '';

    var grid = el('div', 'detail-grid');
    grid.appendChild(detail('Email', application.email));
    grid.appendChild(detail('Phone', application.phone));
    grid.appendChild(detail('City', application.city));
    grid.appendChild(detail('Position', application.position));
    grid.appendChild(detail('Work preference', application.workPreference));
    grid.appendChild(detail('Experience', application.experience));
    grid.appendChild(detail('Expected salary', application.expectedSalary));
    grid.appendChild(detail('Availability', application.availability));

    var portfolio = detail('Portfolio / LinkedIn', application.portfolioUrl, true);
    portfolio.classList.add('full');
    grid.appendChild(portfolio);

    var github = detail('GitHub', application.githubUrl, true);
    github.classList.add('full');
    grid.appendChild(github);

    if (application.source) {
      var source = detail('Came from', application.source);
      source.classList.add('full');
      grid.appendChild(source);
    }
    body.appendChild(grid);

    // Skills
    var skillsSection = el('div', 'drawer-section');
    skillsSection.appendChild(el('h3', null, 'Skills'));
    var tags = el('div', 'skill-tags');
    (application.skills || []).forEach(function (skill) {
      tags.appendChild(el('span', 'skill-tag', skill));
    });
    skillsSection.appendChild(tags);
    body.appendChild(skillsSection);

    // About
    if (application.about) {
      var aboutSection = el('div', 'drawer-section');
      aboutSection.appendChild(el('h3', null, 'About the candidate'));
      aboutSection.appendChild(el('div', 'detail-block', application.about));
      body.appendChild(aboutSection);
    }

    // CV
    var cvSection = el('div', 'drawer-section');
    cvSection.appendChild(el('h3', null, 'CV / Resume'));
    var download = el('a', 'btn btn-primary', 'Download ' + application.cvFileName);
    download.href = '/admin/api/applications/' + application.id + '/cv';
    cvSection.appendChild(download);
    body.appendChild(cvSection);

    // Status + notes
    var manage = el('div', 'drawer-section');
    manage.appendChild(el('h3', null, 'Manage'));

    var statusLabel = el('label', null, 'Status');
    statusLabel.setAttribute('for', 'drawerStatus');
    manage.appendChild(statusLabel);

    var selectWrap = el('div', 'select-wrap');
    var statusSelect = el('select');
    statusSelect.id = 'drawerStatus';
    state.statuses.forEach(function (status) {
      var option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      if (status === application.status) option.selected = true;
      statusSelect.appendChild(option);
    });
    selectWrap.appendChild(statusSelect);
    manage.appendChild(selectWrap);

    var notesLabel = el('label', null, 'Internal notes');
    notesLabel.setAttribute('for', 'drawerNotes');
    notesLabel.style.marginTop = '14px';
    manage.appendChild(notesLabel);

    var notes = el('textarea');
    notes.id = 'drawerNotes';
    notes.rows = 4;
    notes.maxLength = 4000;
    notes.placeholder = 'Visible only to the hiring team.';
    notes.value = application.internalNotes || '';
    manage.appendChild(notes);

    var actions = el('div', 'drawer-actions');
    actions.style.marginTop = '14px';
    var save = el('button', 'btn btn-primary', 'Save changes');
    save.type = 'button';
    actions.appendChild(save);
    manage.appendChild(actions);

    var hint = el('p', 'save-hint');
    manage.appendChild(hint);
    body.appendChild(manage);

    save.addEventListener('click', function () {
      save.disabled = true;
      hint.textContent = '';
      fetch('/admin/api/applications/' + application.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusSelect.value, internalNotes: notes.value })
      })
        .then(handleAuth)
        .then(function (response) { return response.json(); })
        .then(function (result) {
          save.disabled = false;
          if (result.ok) {
            hint.textContent = 'Saved.';
            application.status = result.application.status;
            application.internalNotes = result.application.internalNotes;
            load();
          } else {
            hint.textContent = result.error || 'Could not save.';
          }
        })
        .catch(function () {
          save.disabled = false;
          hint.textContent = 'Could not save.';
        });
    });

    $('drawer').hidden = false;
    $('drawerBackdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    $('drawerClose').focus();
  }

  function closeDrawer() {
    $('drawer').hidden = true;
    $('drawerBackdrop').hidden = true;
    document.body.style.overflow = '';
  }

  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !$('drawer').hidden) closeDrawer();
  });

  /* ------------------------------------------------------------- filters */

  var searchTimer;
  $('search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    var term = this.value;
    searchTimer = setTimeout(function () {
      state.search = term.trim();
      state.page = 1;
      load();
    }, 300);
  });

  $('statusFilter').addEventListener('change', function () {
    state.status = this.value;
    state.page = 1;
    load();
  });

  $('positionFilter').addEventListener('change', function () {
    state.position = this.value;
    state.page = 1;
    load();
  });

  $('fromDate').addEventListener('change', function () {
    state.from = this.value;
    state.page = 1;
    load();
  });

  $('toDate').addEventListener('change', function () {
    state.to = this.value;
    state.page = 1;
    load();
  });

  $('resetFilters').addEventListener('click', function () {
    state.status = 'all';
    state.position = 'all';
    state.search = '';
    state.from = '';
    state.to = '';
    state.page = 1;
    $('search').value = '';
    $('statusFilter').value = 'all';
    $('positionFilter').value = 'all';
    $('fromDate').value = '';
    $('toDate').value = '';
    load();
  });

  $('prevPage').addEventListener('click', function () {
    if (state.page > 1) { state.page -= 1; load(); window.scrollTo({ top: 0 }); }
  });

  $('nextPage').addEventListener('click', function () {
    state.page += 1;
    load();
    window.scrollTo({ top: 0 });
  });

  // Keep the CSV export in sync with the visible filters.
  $('exportBtn').addEventListener('click', function () {
    var params = query();
    params.delete('page');
    params.delete('pageSize');
    this.href = '/admin/api/export.csv?' + params.toString();
  });

  $('logoutBtn').addEventListener('click', function () {
    fetch('/admin/api/logout', { method: 'POST' }).then(function () {
      window.location.href = '/admin/login';
    });
  });

  load();
})();
