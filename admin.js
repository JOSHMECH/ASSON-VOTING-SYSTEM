/* ============================================================
   ASSON VOTING SYSTEM — admin.js
   Responsibilities:
     • Supabase data fetching for analytics
     • Chart.js revenue + leaderboard charts
     • Elections / Positions / Candidates CRUD
     • Archive (flip is_active) & hard delete
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────────────────────
// 1.  CONFIG & SUPABASE REST HELPER
// ──────────────────────────────────────────────────────────────
const CFG = window.ASSON_CONFIG;

/** Thin Supabase REST client using service-role or anon key */
const sb = (() => {
  const base = CFG.supabaseUrl;
  const H = () => ({
    'Content-Type': 'application/json',
    'apikey':       CFG.supabaseKey,
    'Authorization': `Bearer ${CFG.supabaseKey}`,
    'Prefer':       'return=representation',
  });

  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: H() });
      if (!r.ok) throw new Error((await r.json()).message || r.statusText);
      return r.json();
    },
    async post(table, body) {
      const r = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST', headers: H(), body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message || r.statusText);
      return r.json();
    },
    async patch(table, id, body) {
      const r = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, {
        method: 'PATCH', headers: H(), body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message || r.statusText);
      return r.json();
    },
    async del(table, id) {
      const r = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, {
        method: 'DELETE', headers: H(),
      });
      if (!r.ok) throw new Error((await r.json()).message || r.statusText);
      return true;
    },
    async upload(bucket, path, file) {
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          'apikey':        CFG.supabaseKey,
          'Authorization': `Bearer ${CFG.supabaseKey}`,
          'Content-Type':  file.type
        },
        body: file
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || data.message || r.statusText);
      }
      return `${base}/storage/v1/object/public/${bucket}/${path}`;
    },
    async patchQuery(table, queryParam, body) {
      const r = await fetch(`${base}/rest/v1/${table}?${queryParam}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message || r.statusText);
      return r.json();
    },
  };
})();

// ──────────────────────────────────────────────────────────────
// 2.  ADMIN GATE — password-protect the dashboard
// ──────────────────────────────────────────────────────────────
let _gateUnlocked = false;

(function adminGate() {
  const gateEl    = document.getElementById('adminGate');
  const contentEl = document.getElementById('adminContent');
  const formEl    = document.getElementById('gateForm');
  const errorEl   = document.getElementById('gateError');

  // Already authenticated this session?
  if (sessionStorage.getItem('asson_admin_auth') === 'true') {
    gateEl.style.display = 'none';
    contentEl.style.display = '';
    _gateUnlocked = true;
    return;
  }

  // Show gate, hide dashboard
  gateEl.style.display = '';
  contentEl.style.display = 'none';

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    const entered = document.getElementById('gatePassword').value;

    if (entered === CFG.adminPassword) {
      sessionStorage.setItem('asson_admin_auth', 'true');
      gateEl.style.display = 'none';
      contentEl.style.display = '';
      _gateUnlocked = true;
      // Now bootstrap the dashboard
      initDashboard();
    } else {
      errorEl.classList.remove('hidden');
      document.getElementById('gatePassword').value = '';
      document.getElementById('gatePassword').focus();
    }
  });
})();

// ──────────────────────────────────────────────────────────────
// 3.  TOAST
// ──────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'📢'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, 5000);
}

function escHtml(str = '') {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtNaira(n) {
  return '₦' + Number(n||0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ──────────────────────────────────────────────────────────────
// 3.  CHART INSTANCES (kept for updates)
// ──────────────────────────────────────────────────────────────
let revenueChartInst    = null;
let leaderChartInst     = null;

// ──────────────────────────────────────────────────────────────
// 4.  GREEN PALETTE FOR CHARTS
// ──────────────────────────────────────────────────────────────
const GREEN_PALETTE = [
  '#008751','#00a863','#00c972','#005c38','#004d2e',
  '#66d4a0','#33c480','#1a7a4a','#3dba77','#80e5b5',
];

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        font: { family: "'DM Sans', sans-serif", size: 12 },
        color: '#374151',
      },
    },
    tooltip: {
      backgroundColor: '#003320',
      titleFont: { family: "'Playfair Display', serif", size: 13 },
      bodyFont:  { family: "'DM Sans', sans-serif", size: 12 },
      padding: 12,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      ticks:  { font: { family: "'DM Sans', sans-serif", size: 11 }, color: '#6b7280' },
      grid:   { color: 'rgba(0,0,0,.05)' },
    },
    y: {
      ticks:  { font: { family: "'DM Sans', sans-serif", size: 11 }, color: '#6b7280' },
      grid:   { color: 'rgba(0,0,0,.05)' },
    },
  },
};

// ──────────────────────────────────────────────────────────────
// 5.  FETCH OVERVIEW ANALYTICS
// ──────────────────────────────────────────────────────────────
async function fetchOverview() {
  try {
    // ── 5a. Total votes & revenue from the votes table ──────
    const votes = await sb.get(
      'votes?select=number_of_votes,amount_paid,created_at,matric_number,payment_reference,receipt_url,status,candidate_id,candidates(name,positions(title))'
    );

    const approvedVotes = votes.filter(v => v.status === 'approved');

    const totalVotes   = approvedVotes.reduce((s, v) => s + (v.number_of_votes || 0), 0);
    const totalRevenue = approvedVotes.reduce((s, v) => s + Number(v.amount_paid || 0), 0);

    // Unique students (by matric_number or voter_id)
    const uniqueVoters = new Set(approvedVotes.map(v => v.matric_number || v.voter_id)).size;

    // ── 5b. Active elections count ──────────────────────────
    const elections = await sb.get('elections?order=created_at.desc');
    const activeCount = elections.filter(e => e.is_active).length;

    // ── 5c. Revenue over time (group by day) ────────────────
    const dayMap = {};
    approvedVotes.forEach(v => {
      const day = new Date(v.created_at).toLocaleDateString('en-NG', { month:'short', day:'numeric' });
      dayMap[day] = (dayMap[day] || 0) + Number(v.amount_paid || 0);
    });
    const revLabels = Object.keys(dayMap);
    const revData   = Object.values(dayMap);

    // ── 5d. Leaderboard (top 8 candidates by votes) ─────────
    const lbMap = {};
    approvedVotes.forEach(v => {
      const name = v.candidates?.name || 'Unknown';
      lbMap[name] = (lbMap[name] || 0) + (v.number_of_votes || 0);
    });
    const sorted = Object.entries(lbMap).sort((a,b) => b[1]-a[1]).slice(0,8);
    const lbLabels = sorted.map(e => e[0]);
    const lbData   = sorted.map(e => e[1]);

    // ── UPDATE METRICS ──────────────────────────────────────
    document.getElementById('metricRevenue').textContent = fmtNaira(totalRevenue);
    document.getElementById('metricVotes').textContent   = totalVotes.toLocaleString();

    let registeredCount = 0;
    try {
      const regUsers = await sb.get('registered_users?select=id');
      registeredCount = regUsers.length;
    } catch (_) {}
    document.getElementById('metricStudents').textContent = registeredCount.toLocaleString();
    document.getElementById('metricElections').textContent = activeCount;

    const todayStr = new Date().toLocaleDateString('en-NG', { month:'short', day:'numeric' });
    const todayRev  = dayMap[todayStr] || 0;
    const todayVotes= approvedVotes.filter(v => new Date(v.created_at).toDateString() === new Date().toDateString())
                                   .reduce((s,v) => s + v.number_of_votes, 0);
    document.getElementById('metricRevenueDelta').textContent  = `+${fmtNaira(todayRev)} today`;
    document.getElementById('metricVotesDelta').textContent    = `+${todayVotes} today`;

    const deltaStudentsEl = document.getElementById('metricStudentsDelta');
    if (deltaStudentsEl) {
      deltaStudentsEl.textContent = `${uniqueVoters} who voted`;
    }

    // ── RENDER REVENUE CHART ─────────────────────────────────
    renderRevenueChart(revLabels, revData);

    // ── RENDER LEADERBOARD CHART ─────────────────────────────
    renderLeaderboardChart(lbLabels, lbData);

    // ── RENDER RECENT TRANSACTIONS TABLE ────────────────────
    renderRecentGroupedTxns(votes, 'txnTableBody');
    
    // Grouped txns count
    const uniqueRefs = new Set(votes.map(v => v.payment_reference)).size;
    document.getElementById('txnCount').textContent = `${uniqueRefs} transfers`;

    // also populate all-txn table (main panel)
    renderGroupedTxns(votes, 'allTxnTableBody');

    return { votes, elections, lbLabels, lbData };
  } catch (err) {
    showToast('Failed to load analytics: ' + err.message, 'error');
    return { votes: [], elections: [], lbLabels: [], lbData: [] };
  }
}

// ──────────────────────────────────────────────────────────────
// 6.  CHARTS
// ──────────────────────────────────────────────────────────────
function renderRevenueChart(labels, data) {
  const ctx = document.getElementById('revenueChart').getContext('2d');
  if (revenueChartInst) revenueChartInst.destroy();

  revenueChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Revenue (₦)',
        data,
        borderColor: '#008751',
        backgroundColor: 'rgba(0,135,81,0.08)',
        pointBackgroundColor: '#008751',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.45,
        borderWidth: 2.5,
      }],
    },
    options: {
      ...chartDefaults,
      plugins: {
        ...chartDefaults.plugins,
        tooltip: {
          ...chartDefaults.plugins.tooltip,
          callbacks: {
            label: ctx => ' ' + fmtNaira(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: { ...chartDefaults.scales.x },
        y: {
          ...chartDefaults.scales.y,
          ticks: {
            ...chartDefaults.scales.y.ticks,
            callback: v => fmtNaira(v),
          },
        },
      },
    },
  });
}

function renderLeaderboardChart(labels, data) {
  const ctx = document.getElementById('leaderboardChart').getContext('2d');
  if (leaderChartInst) leaderChartInst.destroy();

  leaderChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Votes',
        data,
        backgroundColor: labels.map((_, i) => GREEN_PALETTE[i % GREEN_PALETTE.length] + 'cc'),
        borderColor:     labels.map((_, i) => GREEN_PALETTE[i % GREEN_PALETTE.length]),
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      ...chartDefaults,
      indexAxis: 'y',
      plugins: {
        ...chartDefaults.plugins,
        legend: { display: false },
      },
      scales: {
        x: {
          ...chartDefaults.scales.x,
          ticks: { ...chartDefaults.scales.x.ticks, stepSize: 1 },
        },
        y: { ...chartDefaults.scales.y },
      },
    },
  });
}

// ──────────────────────────────────────────────────────────────
// 7.  TRANSACTIONS TABLE HELPERS & GROUPING
// ──────────────────────────────────────────────────────────────
function groupVotes(votes) {
  const grouped = {};
  votes.forEach(v => {
    const ref = v.payment_reference || 'NO-REF';
    if (!grouped[ref]) {
      grouped[ref] = {
        reference: ref,
        email: v.matric_number || '—',
        votes_count: 0,
        amount: 0,
        receipt_url: v.receipt_url || '',
        status: v.status || 'pending',
        created_at: v.created_at,
        selections: []
      };
    }
    grouped[ref].votes_count += (v.number_of_votes || 0);
    grouped[ref].amount += Number(v.amount_paid || 0);
    if (v.candidates?.name) {
      grouped[ref].selections.push(`${v.candidates.name} (×${v.number_of_votes})`);
    }
  });
  return Object.values(grouped);
}

function renderRecentGroupedTxns(votes, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  const txns = groupVotes(votes).slice(0, 8); // top 8 recent grouped
  
  if (!txns.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-500);">No transactions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = txns.map(t => {
    const statusBadges = {
      pending:  '<span class="badge badge-gold">Pending</span>',
      approved: '<span class="badge badge-green">Approved</span>',
      rejected: '<span class="badge badge-danger">Rejected</span>'
    };
    const badge = statusBadges[t.status] || `<span class="badge badge-gray">${escHtml(t.status)}</span>`;

    return `
      <tr>
        <td><span class="txn-ref" title="${escHtml(t.selections.join(', ')) || 'No candidates'}">${escHtml(t.reference)}</span></td>
        <td>${escHtml(t.email)}</td>
        <td><span class="badge badge-gray">×${t.votes_count}</span></td>
        <td>${fmtNaira(t.amount)}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap;">${fmtDate(t.created_at)}</td>
      </tr>`;
  }).join('');
}

function renderGroupedTxns(votes, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  const txns = groupVotes(votes);
  
  if (!txns.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--gray-500);">No transactions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = txns.map(t => {
    // Badges based on status
    const statusBadges = {
      pending:  '<span class="badge badge-gold">Pending</span>',
      approved: '<span class="badge badge-green">Approved</span>',
      rejected: '<span class="badge badge-danger">Rejected</span>'
    };
    const badge = statusBadges[t.status] || `<span class="badge badge-gray">${escHtml(t.status)}</span>`;

    // Receipt link
    const receiptLink = t.receipt_url 
      ? `<a href="${escHtml(t.receipt_url)}" target="_blank" class="btn btn-outline btn-sm" style="padding:.2rem .5rem; font-size:.75rem;">View Receipt</a>`
      : '<span class="text-muted text-xs">No upload</span>';

    // Actions
    let actions = '—';
    if (t.status === 'pending') {
      actions = `
        <div style="display:flex; gap:.35rem;">
          <button class="btn btn-primary btn-sm approve-txn-btn" data-ref="${escHtml(t.reference)}" style="padding:.25rem .5rem; font-size:.75rem;">Approve</button>
          <button class="btn btn-danger btn-sm reject-txn-btn" data-ref="${escHtml(t.reference)}" style="padding:.25rem .5rem; font-size:.75rem;">Reject</button>
        </div>`;
    }

    return `
      <tr>
        <td><span class="txn-ref" title="${escHtml(t.selections.join(', ')) || 'No candidates'}">${escHtml(t.reference)}</span></td>
        <td>${escHtml(t.email)}</td>
        <td><span class="badge badge-gray">×${t.votes_count}</span></td>
        <td>${fmtNaira(t.amount)}</td>
        <td>${receiptLink}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap;">${fmtDate(t.created_at)}</td>
        <td>${actions}</td>
      </tr>`;
  }).join('');

  // Bind actions
  tbody.querySelectorAll('.approve-txn-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ref = btn.dataset.ref;
      btn.disabled = true; btn.textContent = 'Approve…';
      try {
        await sb.patchQuery('votes', 'payment_reference=eq.' + ref, { status: 'approved' });
        showToast('Transaction approved!');
        await refreshAllData();
      } catch (err) {
        showToast('Approval failed: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Approve';
      }
    });
  });

  tbody.querySelectorAll('.reject-txn-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ref = btn.dataset.ref;
      btn.disabled = true; btn.textContent = 'Reject…';
      try {
        await sb.patchQuery('votes', 'payment_reference=eq.' + ref, { status: 'rejected' });
        showToast('Transaction rejected.');
        await refreshAllData();
      } catch (err) {
        showToast('Rejection failed: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Reject';
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────
// 8.  LEADERBOARD TABLE (full panel)
// ──────────────────────────────────────────────────────────────
async function fetchLeaderboard(electionId) {
  const tbody = document.getElementById('leaderTableBody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="spinner-lg spinner" style="margin:0 auto;"></div></td></tr>`;

  try {
    let query = 'vote_leaderboard?order=total_votes.desc&limit=50';
    if (electionId && electionId !== 'all') {
      query += `&election_title=like.*`; // filter by join
      // use full leaderboard view; filter client-side for now
    }
    const rows = await sb.get(query);
    const filtered = (electionId && electionId !== 'all')
      ? rows.filter(r => r.election_title === electionId)
      : rows;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-500);">No votes yet.</td></tr>`;
      return;
    }

    const maxVotes = filtered[0]?.total_votes || 1;

    tbody.innerHTML = filtered.map((row, i) => {
      const rank    = i + 1;
      const rankCls = rank <= 3 ? `rank-${rank}` : 'rank-n';
      const pct     = Math.round((row.total_votes / maxVotes) * 100);
      return `
        <tr>
          <td><span class="rank-badge ${rankCls}">${rank}</span></td>
          <td>
            <img class="candidate-row-avatar"
                 src="${escHtml(row.photo_url)}"
                 alt="${escHtml(row.candidate_name)}"
                 onerror="this.src='https://placehold.co/32x32/008751/ffffff?text=${encodeURIComponent((row.candidate_name||'?')[0])}'"/>
          </td>
          <td style="font-weight:600;">${escHtml(row.candidate_name)}</td>
          <td><span class="badge badge-gray">${escHtml(row.position_title)}</span></td>
          <td>
            <div class="vote-bar-wrap">
              <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${pct}%;"></div></div>
              <span style="font-weight:700; color:var(--green-900); min-width:35px;">${row.total_votes}</span>
            </div>
          </td>
          <td style="font-weight:600; color:var(--green);">${fmtNaira(row.total_revenue)}</td>
        </tr>`;
    }).join('');
  } catch (err) {
    showToast('Failed to load leaderboard: ' + err.message, 'error');
  }
}

// ──────────────────────────────────────────────────────────────
// 8.5 REGISTERED STUDENTS LIST
// ──────────────────────────────────────────────────────────────
async function fetchStudents() {
  const tbody = document.getElementById('studentTableBody');
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;"><div class="spinner-lg spinner" style="margin:0 auto;"></div></td></tr>`;
  try {
    const students = await sb.get('registered_users?order=created_at.desc');
    document.getElementById('studentCount').textContent = `${students.length} sign ups`;
    
    if (!students.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--gray-500);">No students signed up yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = students.map(s => {
      return `
        <tr>
          <td><span class="txn-ref">${escHtml(s.id||'')}</span></td>
          <td style="font-weight:600;">${escHtml(s.email||'—')}</td>
          <td>${fmtDate(s.created_at)}</td>
          <td>${fmtDate(s.last_sign_in_at)}</td>
        </tr>`;
    }).join('');
  } catch (err) {
    showToast('Failed to load students: ' + err.message, 'error');
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--danger);">Error: ${escHtml(err.message)}</td></tr>`;
  }
}

// ──────────────────────────────────────────────────────────────
// 9.  ELECTIONS CRUD
// ──────────────────────────────────────────────────────────────
let _elections = [];

async function fetchElections() {
  _elections = await sb.get('elections?order=created_at.desc');
  return _elections;
}

async function renderElectionList() {
  const container = document.getElementById('electionListContainer');
  const elections = await fetchElections();

  document.getElementById('electionListCount').textContent = elections.length;

  if (!elections.length) {
    container.innerHTML = '<p class="text-muted text-sm">No elections yet.</p>';
    return;
  }

  container.innerHTML = elections.map(el => `
    <div class="election-item" data-id="${el.id}">
      <div class="election-item-info">
        <div class="election-item-title">${escHtml(el.title)}</div>
        <div class="election-item-meta">
          ${fmtNaira(el.price_per_vote)} / vote
          &nbsp;·&nbsp;
          ${fmtDate(el.created_at)}
        </div>
        <span class="badge ${el.is_active ? 'badge-green' : 'badge-gray'}" style="margin-top:.375rem;">
          ${el.is_active ? '🟢 Active' : '⚫ Archived'}
        </span>
      </div>
      <div class="election-item-actions">
        <button class="btn btn-warning btn-sm archive-btn" data-id="${el.id}" data-active="${el.is_active}" title="${el.is_active ? 'Archive' : 'Activate'}">
          ${el.is_active ? 'Archive' : 'Activate'}
        </button>
        <button class="btn btn-danger btn-sm delete-btn" data-id="${el.id}" data-type="elections" data-name="${escHtml(el.title)}" title="Delete">
          Delete
        </button>
      </div>
    </div>
  `).join('');

  // Archive / activate
  container.querySelectorAll('.archive-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.id;
      const active = btn.dataset.active === 'true';
      try {
        await sb.patch('elections', id, { is_active: !active });
        showToast(`Election ${!active ? 'activated' : 'archived'}.`);
        await refreshAllData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Delete
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => openConfirm(btn.dataset.type, btn.dataset.id, btn.dataset.name));
  });
}

// ──────────────────────────────────────────────────────────────
// 10. POSITIONS CRUD
// ──────────────────────────────────────────────────────────────
async function fetchPositions(electionId) {
  const query = electionId
    ? `positions?election_id=eq.${electionId}&order=created_at.asc`
    : 'positions?order=created_at.asc';
  return sb.get(query);
}

async function renderPositionList() {
  const container = document.getElementById('positionListContainer');
  const positions = await fetchPositions();

  document.getElementById('posListCount').textContent = positions.length;

  if (!positions.length) {
    container.innerHTML = '<p class="text-muted text-sm">No positions yet.</p>';
    return;
  }

  container.innerHTML = positions.map(pos => `
    <div class="election-item">
      <div class="election-item-info">
        <div class="election-item-title">${escHtml(pos.title)}</div>
        ${pos.description ? `<div class="election-item-meta">${escHtml(pos.description)}</div>` : ''}
      </div>
      <div class="election-item-actions">
        <button class="btn btn-danger btn-sm delete-btn" data-id="${pos.id}" data-type="positions" data-name="${escHtml(pos.title)}">Delete</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => openConfirm(btn.dataset.type, btn.dataset.id, btn.dataset.name));
  });
}

// ──────────────────────────────────────────────────────────────
// 11. CANDIDATES CRUD
// ──────────────────────────────────────────────────────────────
async function renderCandidateList(electionId) {
  const container = document.getElementById('candidateListContainer');

  // Fetch positions for this election
  const positions = electionId
    ? await fetchPositions(electionId)
    : await fetchPositions();

  if (!positions.length) {
    container.innerHTML = '<p class="text-muted text-sm">No positions in this election.</p>';
    document.getElementById('candListCount').textContent = '0';
    return;
  }

  const posIds     = positions.map(p => `"${p.id}"`).join(',');
  const candidates = await sb.get(`candidates?position_id=in.(${posIds})&order=name.asc`);
  document.getElementById('candListCount').textContent = candidates.length;

  if (!candidates.length) {
    container.innerHTML = '<p class="text-muted text-sm">No candidates yet.</p>';
    return;
  }

  // Group by position
  const byPos = {};
  positions.forEach(p => { byPos[p.id] = { pos: p, candidates: [] }; });
  candidates.forEach(c => {
    if (byPos[c.position_id]) byPos[c.position_id].candidates.push(c);
  });

  container.innerHTML = Object.values(byPos).map(({ pos, candidates: cands }) => {
    if (!cands.length) return '';
    return `
      <div style="margin-bottom:1rem;">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--gray-500);margin-bottom:.5rem;">${escHtml(pos.title)}</div>
        ${cands.map(c => `
          <div class="election-item" style="margin-bottom:.5rem;">
            <img src="${escHtml(c.photo_url)}"
                 style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0;"
                 onerror="this.src='https://placehold.co/40x40/008751/ffffff?text=${encodeURIComponent((c.name||'?')[0])}'" />
            <div class="election-item-info">
              <div class="election-item-title">${escHtml(c.name)}</div>
              ${c.bio ? `<div class="election-item-meta">${escHtml(c.bio)}</div>` : ''}
            </div>
            <div class="election-item-actions">
              <button class="btn btn-danger btn-sm delete-btn" data-id="${c.id}" data-type="candidates" data-name="${escHtml(c.name)}">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>`;
  }).join('');

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => openConfirm(btn.dataset.type, btn.dataset.id, btn.dataset.name));
  });
}

// ──────────────────────────────────────────────────────────────
// 12. POPULATE ELECTION DROPDOWNS
// ──────────────────────────────────────────────────────────────
async function populateElectionDropdowns() {
  const elections = await fetchElections();
  const makeOptions = (includeAll = false) => {
    const all = includeAll ? `<option value="all">All Elections</option>` : '';
    return all + elections.map(e =>
      `<option value="${e.id}">${escHtml(e.title)} ${e.is_active ? '🟢' : '⚫'}</option>`
    ).join('');
  };

  const ids = ['posElection','candElection','leaderElectionFilter','candFilterElection'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const includeAll = ['leaderElectionFilter','candFilterElection'].includes(id);
      el.innerHTML = makeOptions(includeAll);
    }
  });
}

// When candElection changes, update candPosition options
async function updatePositionDropdown(electionId) {
  const sel = document.getElementById('candPosition');
  sel.innerHTML = '<option value="">Loading…</option>';
  const positions = await fetchPositions(electionId);
  sel.innerHTML = positions.map(p =>
    `<option value="${p.id}">${escHtml(p.title)}</option>`
  ).join('') || '<option value="">No positions</option>';
}

// ──────────────────────────────────────────────────────────────
// 13. CONFIRM DELETE MODAL
// ──────────────────────────────────────────────────────────────
let _pendingDelete = null;

function openConfirm(type, id, name) {
  _pendingDelete = { type, id };
  document.getElementById('confirmMsg').textContent =
    `Permanently delete "${name}" from ${type}? All related records (cascading) will also be removed.`;
  document.getElementById('confirmModal').classList.remove('hidden');
}

document.getElementById('confirmCancelBtn').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.add('hidden');
  _pendingDelete = null;
});

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!_pendingDelete) return;
  const { type, id } = _pendingDelete;
  try {
    await sb.del(type, id);
    showToast(`Deleted successfully.`);
    document.getElementById('confirmModal').classList.add('hidden');
    _pendingDelete = null;
    await refreshAllData();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
});

// ──────────────────────────────────────────────────────────────
// 14. SIDEBAR NAVIGATION
// ──────────────────────────────────────────────────────────────
const PANELS = ['overview','leaderboard','transactions','students','elections','positions','candidates','payments'];
const TITLES = {
  overview:     'Overview',
  leaderboard:  'Live Leaderboard',
  transactions: 'Transactions',
  students:     'Registered Students',
  elections:    'Election Management',
  positions:    'Category Management',
  candidates:   'Candidate Management',
  payments:     'Payment Settings',
};

function switchPanel(panel) {
  PANELS.forEach(p => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.classList.toggle('hidden', p !== panel);
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });
  document.getElementById('topbarTitle').textContent = TITLES[panel] || panel;

  // Lazy-load data per panel
  if (panel === 'overview')     { fetchOverview(); }
  if (panel === 'leaderboard')  {
    const el = document.getElementById('leaderElectionFilter').value;
    fetchLeaderboard(el);
  }
  if (panel === 'transactions') { fetchOverview(); }
  if (panel === 'students')     { fetchStudents(); }
  if (panel === 'payments')     { fetchBankDetails(); }
  if (panel === 'elections')    { renderElectionList(); }
  if (panel === 'positions')    { renderPositionList(); }
  if (panel === 'candidates')   {
    const el = document.getElementById('candFilterElection').value;
    renderCandidateList(el !== 'all' ? el : null);
  }
}

document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});

// Sidebar toggle for mobile
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('sidebar-open');
  document.querySelector('.sidebar-overlay')?.remove();
  if (document.querySelector('.sidebar').classList.contains('sidebar-open')) {
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', () => {
      document.querySelector('.sidebar').classList.remove('sidebar-open');
      overlay.remove();
    });
    document.querySelector('.admin-layout').appendChild(overlay);
  }
});

// Close sidebar on nav click (mobile)
document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.remove('sidebar-open');
    document.querySelector('.sidebar-overlay')?.remove();
  });
});

// ──────────────────────────────────────────────────────────────
// 15. FORM HANDLERS
// ──────────────────────────────────────────────────────────────

// CREATE ELECTION
document.getElementById('createElectionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('createElectionBtn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await sb.post('elections', {
      title:          document.getElementById('elTitle').value.trim(),
      description:    document.getElementById('elDesc').value.trim() || null,
      price_per_vote: parseFloat(document.getElementById('elPrice').value) || 100,
      is_active:      document.getElementById('elActive').checked,
    });
    showToast('Election created!');
    e.target.reset();
    document.getElementById('elActive').checked = true;
    await refreshAllData();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Election';
  }
});

// CREATE POSITION
document.getElementById('createPositionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('createPositionBtn');
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    await sb.post('positions', {
      election_id: document.getElementById('posElection').value,
      title:       document.getElementById('posTitle').value.trim(),
      description: document.getElementById('posDesc').value.trim() || null,
    });
    showToast('Position added!');
    e.target.reset();
    await refreshAllData();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Add Position';
  }
});

// CREATE CANDIDATE
document.getElementById('createCandidateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('createCandidateBtn');
  btn.disabled = true; btn.textContent = 'Adding…';
  const name = document.getElementById('candName').value.trim();
  const photoFileInput = document.getElementById('candPhotoFile');
  let photoUrl = document.getElementById('candPhoto').value.trim();

  try {
    // If a file is selected, upload it first
    if (photoFileInput.files && photoFileInput.files[0]) {
      btn.textContent = 'Uploading photo…';
      const file = photoFileInput.files[0];
      const fileExt = file.name.split('.').pop();
      const uniqueFileName = `candidate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
      
      // Upload to the candidate-photos storage bucket
      photoUrl = await sb.upload('candidate-photos', uniqueFileName, file);
    }

    // Default fallback placeholder if no image URL or file uploaded
    if (!photoUrl) {
      photoUrl = `https://placehold.co/200x200/008751/ffffff?text=${encodeURIComponent(name[0]||'?')}`;
    }

    await sb.post('candidates', {
      position_id: document.getElementById('candPosition').value,
      name,
      photo_url:   photoUrl,
      bio:         document.getElementById('candBio').value.trim() || null,
    });
    showToast('Candidate added!');
    e.target.reset();
    await refreshAllData();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Add Candidate';
  }
});

// Dynamic position dropdown when election changes on candidate form
document.getElementById('candElection').addEventListener('change', function () {
  updatePositionDropdown(this.value);
});

// Leaderboard election filter
document.getElementById('leaderElectionFilter').addEventListener('change', function () {
  fetchLeaderboard(this.value);
});

// Candidate filter
document.getElementById('candFilterElection').addEventListener('change', function () {
  renderCandidateList(this.value !== 'all' ? this.value : null);
});

// Transaction search
document.getElementById('txnSearch').addEventListener('input', function () {
  const q = this.value.toLowerCase();
  const rows = document.querySelectorAll('#allTxnTableBody tr');
  rows.forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// Student search
document.getElementById('studentSearch').addEventListener('input', function () {
  const q = this.value.toLowerCase();
  const rows = document.querySelectorAll('#studentTableBody tr');
  rows.forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// Refresh button
document.getElementById('refreshBtn').addEventListener('click', async () => {
  await refreshAllData();
  showToast('Data refreshed.', 'info');
});

// ──────────────────────────────────────────────────────────────
// 16. AUTO-REFRESH (every 30 seconds on active panels)
// ──────────────────────────────────────────────────────────────
setInterval(() => {
  const active = document.querySelector('.nav-item.active')?.dataset.panel;
  if (active === 'overview') fetchOverview();
  if (active === 'leaderboard') {
    const el = document.getElementById('leaderElectionFilter').value;
    fetchLeaderboard(el);
  }
  if (active === 'students') fetchStudents();
  if (active === 'payments') fetchBankDetails();
}, 30000);

// ──────────────────────────────────────────────────────────────
// 16.5 BANK ACCOUNT DETAILS SETTINGS EDITOR
// ──────────────────────────────────────────────────────────────
let _activeBank = null;

async function fetchBankDetails() {
  const container = document.getElementById('activeBankContainer');
  container.innerHTML = `<div class="page-loader"><div class="spinner spinner-lg"></div></div>`;
  try {
    const details = await sb.get('bank_details?order=created_at.desc');
    if (!details.length) {
      container.innerHTML = '<p class="text-muted text-sm">No bank credentials configured. Use the form on the left to set details.</p>';
      return;
    }
    
    _activeBank = details[0]; // first one is active
    
    // Fill the inputs with current active details
    document.getElementById('bankNameInput').value = _activeBank.bank_name;
    document.getElementById('accountNumberInput').value = _activeBank.account_number;
    document.getElementById('accountNameInput').value = _activeBank.account_name;

    container.innerHTML = `
      <div style="background:var(--green-50); border:1px solid var(--green-100); border-radius:var(--radius-md); padding:1rem; display:flex; flex-direction:column; gap:.5rem;">
        <div style="display:flex; justify-content:space-between; font-size:.85rem;">
          <span class="text-muted">Bank Name</span>
          <span class="font-semi text-green">${escHtml(_activeBank.bank_name)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:.85rem;">
          <span class="text-muted">Account Number</span>
          <span class="font-semi text-green" style="font-family:monospace; font-size:.95rem;">${escHtml(_activeBank.account_number)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:.85rem;">
          <span class="text-muted">Account Name</span>
          <span class="font-semi text-green">${escHtml(_activeBank.account_name)}</span>
        </div>
      </div>
    `;
  } catch (err) {
    showToast('Failed to load bank details: ' + err.message, 'error');
    container.innerHTML = `<p class="text-danger text-sm">Error: ${escHtml(err.message)}</p>`;
  }
}

// Update bank form submit
document.getElementById('updateBankForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('updateBankBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  
  const bank_name = document.getElementById('bankNameInput').value.trim();
  const account_number = document.getElementById('accountNumberInput').value.trim();
  const account_name = document.getElementById('accountNameInput').value.trim();

  try {
    if (_activeBank) {
      // Update existing
      await sb.patch('bank_details', _activeBank.id, { bank_name, account_number, account_name });
      showToast('Bank details updated successfully!');
    } else {
      // Insert new
      await sb.post('bank_details', { bank_name, account_number, account_name, is_active: true });
      showToast('Bank details saved!');
    }
    await refreshAllData();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Details';
  }
});

// ──────────────────────────────────────────────────────────────
// 17. BOOTSTRAP / DATA REFRESH HELPER
// ──────────────────────────────────────────────────────────────
async function refreshAllData() {
  const active = document.querySelector('.nav-item.active')?.dataset.panel || 'overview';
  
  // Re-populate dropdowns
  await populateElectionDropdowns();
  
  // Trigger position dropdown for candidate form
  const candEl = document.getElementById('candElection')?.value;
  if (candEl) await updatePositionDropdown(candEl);

  // Refresh active view
  if (active === 'overview')     await fetchOverview();
  if (active === 'leaderboard')  {
    const el = document.getElementById('leaderElectionFilter').value;
    await fetchLeaderboard(el);
  }
  if (active === 'transactions') { await fetchOverview(); }
  if (active === 'students')     { await fetchStudents(); }
  if (active === 'payments')     { await fetchBankDetails(); }
  if (active === 'elections')    { await renderElectionList(); }
  if (active === 'positions')    { await renderPositionList(); }
  if (active === 'candidates')   {
    const el = document.getElementById('candFilterElection').value;
    await renderCandidateList(el !== 'all' ? el : null);
  }
}

async function initDashboard() {
  await refreshAllData();
}

// Only auto-init if gate was already unlocked (returning session)
if (_gateUnlocked) {
  initDashboard();
}
