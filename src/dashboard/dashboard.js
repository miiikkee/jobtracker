import { getJobs } from '../utils/storage.js';

// ── Init ──────────────────────────────────────────────

let allJobs = [];
let trendPeriod = '8w';

async function init() {
  document.getElementById('back-btn').addEventListener('click', () => window.close());
  document.getElementById('csv-btn').addEventListener('click', () => exportCSV(allJobs));
  document.getElementById('notion-btn').addEventListener('click', () => exportNotion(allJobs));

  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      trendPeriod = btn.dataset.period;
      renderTrend(allJobs);
    });
  });

  allJobs = await getJobs();

  renderStats(allJobs);
  renderTrend(allJobs);
  renderFunnel(allJobs);
  renderFollowUp(allJobs);
  renderActivity(allJobs);
  await setupNotionButton();

  document.getElementById('last-updated').textContent =
    `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ── Stats ─────────────────────────────────────────────

function renderStats(jobs) {
  const everApplied   = jobs.filter(j => j.appliedAt || ['applied','interviewing','offer','rejected'].includes(j.status));
  const everInterview = jobs.filter(j => j.interviewAt || j.status === 'interviewing' || j.status === 'offer');
  const offers        = jobs.filter(j => j.status === 'offer');

  const interviewRate = everApplied.length ? Math.round(everInterview.length / everApplied.length * 100) : 0;
  const offerRate     = everApplied.length ? Math.round(offers.length / everApplied.length * 100) : 0;

  const responseTimes = jobs
    .filter(j => j.appliedAt && j.interviewAt)
    .map(j => Math.floor((new Date(j.interviewAt) - new Date(j.appliedAt)) / 86400000))
    .filter(d => d >= 0 && d < 180);

  const avgResp = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;

  document.getElementById('s-total').textContent          = jobs.length;
  document.getElementById('s-applied').textContent        = everApplied.length;
  document.getElementById('s-interview-rate').textContent = `${interviewRate}%`;
  document.getElementById('s-offer-rate').textContent     = `${offerRate}%`;
  document.getElementById('s-avg-response').textContent   = avgResp != null ? `${avgResp}d` : '—';
}

// ── Trend chart ───────────────────────────────────────

function renderTrend(jobs) {
  const container = document.getElementById('trend-chart');
  const weeks = trendPeriod === '3m' ? 12 : 8;
  const data   = getWeeklyData(jobs, weeks);
  const total  = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    container.innerHTML = '<div class="chart-empty">No applications recorded yet</div>';
    return;
  }

  container.innerHTML = buildBarChartSVG(data);
}

function getWeeklyData(jobs, weeks) {
  const now = new Date();
  // Align to start of current week (Monday)
  const dayOfWeek = (now.getDay() + 6) % 7; // Mon=0
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - dayOfWeek);
  thisWeekStart.setHours(0, 0, 0, 0);

  const result = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(thisWeekStart);
    weekStart.setDate(thisWeekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const count = jobs.filter(j => {
      const d = new Date(j.appliedAt || j.savedAt);
      return d >= weekStart && d < weekEnd;
    }).length;

    const m = weekStart.getMonth() + 1;
    const d = weekStart.getDate();
    result.push({ label: `${m}/${d}`, count, isCurrent: i === 0 });
  }
  return result;
}

function buildBarChartSVG(data) {
  const BAR_W    = 36;
  const GAP      = 10;
  const CHART_H  = 110;
  const LABEL_H  = 22;
  const PAD_TOP  = 20;
  const n        = data.length;
  const W        = n * (BAR_W + GAP) - GAP;
  const maxVal   = Math.max(...data.map(d => d.count), 1);

  const bars = data.map((d, i) => {
    const x    = i * (BAR_W + GAP);
    const barH = d.count > 0 ? Math.max(4, Math.round(d.count / maxVal * CHART_H)) : 3;
    const y    = PAD_TOP + CHART_H - barH;
    const fill = d.count > 0
      ? (d.isCurrent ? '#22c55e' : '#14432a')
      : '#1e2330';
    const countY = y - 6;

    return `
      <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="3" fill="${fill}"/>
      ${d.count > 0 ? `<text x="${x + BAR_W / 2}" y="${countY}" text-anchor="middle" font-size="10" fill="#8b949e">${d.count}</text>` : ''}
      <text x="${x + BAR_W / 2}" y="${PAD_TOP + CHART_H + LABEL_H}" text-anchor="middle" font-size="9" fill="${d.isCurrent ? '#8b949e' : '#3d4450'}">${d.label}</text>
    `;
  }).join('');

  const totalH = PAD_TOP + CHART_H + LABEL_H + 8;
  return `
    <svg viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg"
         style="width:100%;overflow:visible">
      ${bars}
    </svg>`;
}

// ── Funnel ────────────────────────────────────────────

function renderFunnel(jobs) {
  const wrap = document.getElementById('funnel-wrap');

  const total       = jobs.length;
  const applied     = jobs.filter(j => j.appliedAt || ['applied','interviewing','offer','rejected'].includes(j.status)).length;
  const interviewing= jobs.filter(j => j.interviewAt || j.status === 'interviewing' || j.status === 'offer').length;
  const offers      = jobs.filter(j => j.status === 'offer').length;
  const rejected    = jobs.filter(j => j.status === 'rejected').length;

  const stages = [
    { label: 'Saved',        count: total,        color: '#3d4450', max: total },
    { label: 'Applied',      count: applied,       color: '#3b82f6', max: total },
    { label: 'Interviewing', count: interviewing,  color: '#f59e0b', max: total },
    { label: 'Offer',        count: offers,        color: '#22c55e', max: total },
    { label: 'Rejected',     count: rejected,      color: '#ef4444', max: total },
  ];

  wrap.innerHTML = stages.map((s, i) => {
    const pct = total > 0 ? (s.count / total * 100).toFixed(0) : 0;
    const prev = i > 0 ? stages[i - 1] : null;
    const convPct = prev && prev.count > 0
      ? Math.round(s.count / prev.count * 100)
      : null;

    const arrowHtml = i > 0 ? `
      <div class="funnel-arrow">
        ${convPct !== null ? `${convPct}% conversion from ${prev.label}` : ''}
      </div>` : '';

    return `
      ${arrowHtml}
      <div class="funnel-row">
        <div class="funnel-label">${s.label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${pct}%;background:${s.color}40;border-left:3px solid ${s.color}"></div>
        </div>
        <div class="funnel-count" style="color:${s.color}">${s.count}</div>
        <div class="funnel-conv">${pct}%</div>
      </div>`;
  }).join('');
}

// ── Follow-up ─────────────────────────────────────────

function renderFollowUp(jobs) {
  const list    = document.getElementById('followup-list');
  const badge   = document.getElementById('followup-badge');
  const DAYS    = 7;
  const now     = Date.now();

  const overdue = jobs
    .filter(j => j.status === 'applied' && j.appliedAt)
    .map(j => ({ ...j, daysSince: Math.floor((now - new Date(j.appliedAt)) / 86400000) }))
    .filter(j => j.daysSince >= DAYS)
    .sort((a, b) => b.daysSince - a.daysSince);

  if (!overdue.length) {
    list.innerHTML = '<div class="empty-tip">No overdue applications 🎉</div>';
    badge.textContent = '';
    return;
  }

  badge.textContent = overdue.length;
  list.innerHTML = overdue.map(j => {
    const company = j.summary?.company_confirmed || j.company || '—';
    const title   = j.summary?.title_confirmed   || j.title   || '';
    return `
      <div class="followup-row">
        <div>
          <div class="followup-company">${company}</div>
          ${title ? `<div style="font-size:10px;color:var(--text-3);margin-top:1px">${title}</div>` : ''}
        </div>
        <span class="followup-days">${j.daysSince}d ago</span>
        ${j.url ? `<a class="followup-link" href="${j.url}" target="_blank">View JD</a>` : ''}
      </div>`;
  }).join('');
}

// ── Recent activity ───────────────────────────────────

function renderActivity(jobs) {
  const list = document.getElementById('activity-list');

  // Collect dated events
  const events = [];
  jobs.forEach(j => {
    const company = j.summary?.company_confirmed || j.company || '—';
    const title   = j.summary?.title_confirmed   || j.title   || '';
    if (j.savedAt)    events.push({ date: j.savedAt,    status: 'saved',        company, title });
    if (j.appliedAt)  events.push({ date: j.appliedAt,  status: 'applied',      company, title });
    if (j.interviewAt)events.push({ date: j.interviewAt,status: 'interviewing', company, title });
    if (j.status === 'offer'    && j.interviewAt) events.push({ date: j.interviewAt, status: 'offer',    company, title });
    if (j.status === 'rejected' && j.appliedAt)  events.push({ date: j.appliedAt,  status: 'rejected', company, title });
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = events.slice(0, 10);

  if (!recent.length) {
    list.innerHTML = '<div class="empty-tip">No activity yet</div>';
    return;
  }

  const statusLabel = { saved:'Saved', applied:'Applied', interviewing:'Interview', offer:'Offer', rejected:'Rejected' };
  const now = Date.now();

  list.innerHTML = recent.map(e => {
    const daysAgo = Math.floor((now - new Date(e.date)) / 86400000);
    const timeStr = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
    return `
      <div class="activity-row">
        <div class="activity-dot dot-${e.status}"></div>
        <div class="activity-text">
          <strong>${e.company}</strong> · ${statusLabel[e.status]}
          ${e.title ? `<br><span style="font-size:10px">${e.title}</span>` : ''}
        </div>
        <div class="activity-time">${timeStr}</div>
      </div>`;
  }).join('');
}

// ── Notion ────────────────────────────────────────────

async function setupNotionButton() {
  const { notionToken, notionDbId } = await chrome.storage.local.get(['notionToken','notionDbId']);
  const btn  = document.getElementById('notion-btn');
  const desc = document.getElementById('notion-desc');
  if (notionToken && notionDbId) {
    btn.disabled = false;
    desc.textContent = 'Sync all applications to your Notion database';
  } else {
    desc.innerHTML = '<a href="#" id="notion-settings-link" style="color:#3b82f6;text-decoration:none">Configure in Settings →</a>';
    document.getElementById('notion-settings-link')?.addEventListener('click', e => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

async function exportNotion(jobs) {
  const btn    = document.getElementById('notion-btn');
  const status = document.getElementById('export-status');
  const { notionToken, notionDbId } = await chrome.storage.local.get(['notionToken','notionDbId']);

  if (!notionToken || !notionDbId) { chrome.runtime.openOptionsPage(); return; }

  btn.disabled = true; btn.textContent = 'Syncing...';
  status.className = ''; status.textContent = '';

  const statusMap = { saved:'Saved', applied:'Applied', interviewing:'Interviewing', offer:'Offer', rejected:'Rejected' };
  let success = 0, failed = 0;

  for (const job of jobs) {
    const title   = job.summary?.title_confirmed   || job.title   || 'Unknown Role';
    const company = job.summary?.company_confirmed || job.company || '';

    const body = {
      parent: { database_id: notionDbId },
      properties: {
        Name:    { title:     [{ text: { content: `${company} — ${title}` } }] },
        Company: { rich_text: [{ text: { content: company } }] },
        Role:    { rich_text: [{ text: { content: title } }] },
        Status:  { select:   { name: statusMap[job.status] || 'Saved' } },
        ...(job.appliedAt ? { Applied: { date: { start: job.appliedAt.slice(0, 10) } } } : {}),
        ...(job.url ? { URL: { url: job.url } } : {}),
      },
    };

    try {
      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) success++; else failed++;
    } catch (_) { failed++; }
  }

  btn.disabled = false; btn.textContent = 'Sync';
  if (failed === 0) {
    status.className = 'export-status ok';
    status.textContent = `✓ Synced ${success} applications to Notion`;
  } else {
    status.className = 'export-status err';
    status.textContent = `Synced ${success}, failed ${failed}. Check your token and database permissions.`;
  }
}

// ── CSV ───────────────────────────────────────────────

function exportCSV(jobs) {
  const status  = document.getElementById('export-status');
  const headers = ['Title','Company','Location','Status','Saved','Applied','Interview','URL','Skills','Summary'];
  const rows = jobs.map(j => [
    j.summary?.title_confirmed   || j.title    || '',
    j.summary?.company_confirmed || j.company  || '',
    j.summary?.meta?.location    || j.location || '',
    j.status || '',
    j.savedAt    ? j.savedAt.slice(0, 10)    : '',
    j.appliedAt  ? j.appliedAt.slice(0, 10)  : '',
    j.interviewAt? j.interviewAt.slice(0, 10): '',
    j.url        || '',
    (j.summary?.skills || []).join(' | '),
    j.summary?.role_summary || '',
  ]);
  const csv  = [headers, ...rows].map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `jobtracker_${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click(); URL.revokeObjectURL(url);
  status.className = 'export-status ok';
  status.textContent = `✓ Exported ${jobs.length} applications`;
}

init();
