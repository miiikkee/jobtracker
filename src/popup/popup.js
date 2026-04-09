import { I18N } from '../utils/i18n.js';
import { getJobs, saveJobs, getApiKey, getLang, setLang, getGoogleClientId } from '../utils/storage.js';
import { fetchCompanyName, summarizeJob } from '../utils/ai.js';
import { grabAnyPage } from '../utils/scraper.js';
import {
  getGmailToken, clearGmailToken, fetchJobEmails,
  analyzeEmailsWithAI, getLastScanAt, saveLastScanAt,
} from '../utils/gmail.js';

let currentLang   = 'zh';
let currentFilter = 'all';
let currentSort   = 'saved';
let T = I18N.zh;

// ── Time helpers ──────────────────────────────────────

function daysAgo(iso) {
  return Math.floor((Date.now() - new Date(iso)) / 86400000);
}

// ── i18n ─────────────────────────────────────────────

function applyI18n() {
  T = I18N[currentLang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (T[key]) el.textContent = T[key];
  });
  document.getElementById('capture-btn').textContent = T.save_btn;
  document.getElementById('lang-btn').textContent = currentLang === 'zh' ? 'EN' : '中';
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const key = { saved:'sort_apply', company:'sort_company', status:'sort_status' }[btn.dataset.sort];
    if (key && T[key]) btn.textContent = T[key];
  });
}

// ── Render ────────────────────────────────────────────

function renderStats(jobs) {
  document.getElementById('stat-total').textContent       = jobs.length;
  document.getElementById('stat-applied').textContent     = jobs.filter(j => j.status === 'applied').length;
  document.getElementById('stat-interviewing').textContent= jobs.filter(j => j.status === 'interviewing').length;
  document.getElementById('stat-offer').textContent       = jobs.filter(j => j.status === 'offer').length;
}

function sortJobs(jobs) {
  const arr = [...jobs];
  if (currentSort === 'applied') {
    return arr.sort((a, b) => {
      if (a.appliedAt && b.appliedAt) return new Date(b.appliedAt) - new Date(a.appliedAt);
      if (a.appliedAt) return -1;
      if (b.appliedAt) return 1;
      return new Date(b.savedAt) - new Date(a.savedAt);
    });
  }
  if (currentSort === 'company') return arr.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
  if (currentSort === 'status') {
    const order = { offer:0, interviewing:1, applied:2, saved:3, rejected:4 };
    return arr.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }
  return arr.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

function renderJobs(jobs) {
  const list = document.getElementById('job-list');
  const filtered = currentFilter === 'all' ? jobs : jobs.filter(j => j.status === currentFilter);
  const visible  = sortJobs(filtered);

  if (!visible.length) {
    list.innerHTML = `<div class="empty-state">
      <div style="font-size:24px">${T.empty_title}</div>
      <p>${T.empty_msg.replace('\n', '<br>')}</p></div>`;
    return;
  }

  list.innerHTML = visible.map(job => {
    const s = job.summary;
    const displayCompany = s?.company_confirmed || job.company || '';
    const displayTitle   = s?.title_confirmed   || job.title   || '';
    const keywords = s?.skills?.map(k => `<span class="tag-kw">${k}</span>`).join('') || '';
    const resp     = s?.responsibilities?.map(r => `<span class="tag-sk">${r}</span>`).join('') || '';
    const reqs     = s?.requirements?.map(r => `<span class="tag-req">${r}</span>`).join('') || '';
    const nextKey  = { saved:'applied', applied:'interviewing', interviewing:'offer' }[job.status];
    const appliedDays = job.appliedAt ? daysAgo(job.appliedAt) : null;
    const savedDays   = daysAgo(job.savedAt);
    const isOverdue   = job.status === 'applied' && appliedDays !== null && appliedDays > 14;
    const timeBadge   = job.status === 'applied' && appliedDays !== null
      ? `<span class="time-badge${isOverdue ? ' overdue' : ''}">${T.days_since_apply(appliedDays)}</span>`
      : `<span class="time-badge">${T.days_ago(savedDays)}</span>`;

    const steps = ['saved','applied','interviewing','offer'];
    const curIdx = steps.indexOf(job.status);
    const tlHtml = steps.map((step, i) => `
      <span class="tl-step">
        <span class="tl-dot ${i <= curIdx ? 'tl-done' : 'tl-pending'}"></span>
        <span style="color:${i <= curIdx ? 'var(--text-secondary)' : 'var(--text-muted)'}">${T.status[step]}</span>
      </span>`).join('<span style="color:var(--text-muted);margin:0 2px">›</span>');

    return `
    <div class="job-item" id="job-${job.id}">
      <div class="job-header">
        <div class="job-company editable" data-id="${job.id}" data-field="company" title="点击编辑">${displayCompany || '—'}</div>
        <div class="job-title editable" data-id="${job.id}" data-field="title" title="点击编辑">${displayTitle}</div>
        <div class="job-meta">
          <span class="status-dot status-${job.status}"></span>
          <span>${T.status[job.status] || job.status}</span>
          ${job.location ? `<span>·</span><span>${job.location}</span>` : ''}
          ${timeBadge}
        </div>
      </div>
      <div class="timeline">${tlHtml}</div>

      ${s ? `
        <div class="summary-wrap" id="sw-${job.id}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <button class="collapse-btn" data-id="${job.id}">▾ ${T.collapse}</button>
            ${job.summaryLang && job.summaryLang !== currentLang
              ? `<button class="regen-btn ai-btn" data-id="${job.id}" style="margin:0">${T.regen}</button>` : ''}
          </div>
          <div class="summary-body">
            ${s.company_intro ? `<div class="summary-company">🏢 ${s.company_intro}</div>` : ''}
            ${s.role_summary  ? `<div class="summary-text">📋 ${s.role_summary}</div>` : ''}
            ${s.meta ? `<div class="summary-meta">
              ${s.meta.location  ? `<span>📍 ${s.meta.location}</span>`  : ''}
              ${s.meta.salary    ? `<span>💰 ${s.meta.salary}</span>`    : ''}
              ${s.meta.work_mode ? `<span>🏠 ${s.meta.work_mode}</span>` : ''}
            </div>` : ''}
            ${reqs     ? `<div class="tag-section-label">硬性要求</div><div class="tag-row">${reqs}</div>` : ''}
            ${resp     ? `<div class="tag-section-label">核心职责</div><div class="tag-row">${resp}</div>` : ''}
            ${keywords ? `<div class="tag-section-label">技能</div><div class="tag-row">${keywords}</div>` : ''}
            ${s.highlight ? `<div class="highlight">⭐ ${s.highlight}</div>` : ''}
          </div>
        </div>
      ` : `<button class="ai-btn" data-id="${job.id}">${T.ai_btn}</button>`}

      <div class="job-actions">
        ${job.url ? `<a class="action-link" href="${job.url}" target="_blank">${T.view}</a>` : ''}
        ${job.url ? `<a class="apply-link" href="${job.applyUrl || job.url}" target="_blank">${T.apply}</a>` : ''}
        <button class="prep-btn" data-id="${job.id}">${T.prep_btn}</button>
        ${nextKey ? `<button class="advance-btn" data-id="${job.id}" data-next="${nextKey}">${T.next[job.status]}</button>` : ''}
        <button class="delete-btn" data-id="${job.id}">${T.del}</button>
      </div>
    </div>`;
  }).join('');

  // Inline edit
  list.querySelectorAll('.editable').forEach(el => {
    el.addEventListener('click', () => {
      if (el.getAttribute('contenteditable') === 'true') return;
      el.setAttribute('contenteditable', 'true');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    const saveEdit = async () => {
      el.removeAttribute('contenteditable');
      const newVal = el.innerText.trim();
      if (!newVal) return;
      const jobs = await getJobs();
      const job = jobs.find(j => j.id === el.dataset.id);
      if (!job) return;
      job[el.dataset.field] = newVal;
      if (job.summary) {
        if (el.dataset.field === 'company') job.summary.company_confirmed = newVal;
        if (el.dataset.field === 'title')   job.summary.title_confirmed   = newVal;
      }
      await saveJobs(jobs);
    };
    el.addEventListener('blur', saveEdit);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') el.removeAttribute('contenteditable');
    });
  });

  list.querySelectorAll('.ai-btn:not(.regen-btn)').forEach(b => b.addEventListener('click', () => handleSummarize(b.dataset.id)));
  list.querySelectorAll('.regen-btn').forEach(b => b.addEventListener('click', () => handleSummarize(b.dataset.id)));
  list.querySelectorAll('.prep-btn').forEach(b => b.addEventListener('click', () => handleInterviewPrep(b.dataset.id)));
  list.querySelectorAll('.advance-btn').forEach(b => b.addEventListener('click', () => handleAdvance(b.dataset.id, b.dataset.next)));
  list.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', () => handleDelete(b.dataset.id)));
  list.querySelectorAll('.collapse-btn').forEach(b => b.addEventListener('click', () => {
    const wrap = document.getElementById(`sw-${b.dataset.id}`);
    const body = wrap.querySelector('.summary-body');
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    b.textContent = collapsed ? `▾ ${T.collapse}` : `▸ ${T.expand}`;
  }));
}

// ── Action handlers ───────────────────────────────────

async function handleSummarize(jobId) {
  const apiKey = await getApiKey();
  if (!apiKey) { alert('请先在设置里填写 Claude API Key'); chrome.runtime.openOptionsPage(); return; }
  const btn = document.querySelector(`[data-id="${jobId}"].ai-btn, [data-id="${jobId}"].regen-btn`);
  if (btn) { btn.textContent = T.ai_loading; btn.disabled = true; }
  const jobs = await getJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  try {
    const summary = await summarizeJob(job, apiKey, currentLang);
    job.summary = summary;
    job.summaryLang = currentLang;
    if (summary.company_confirmed) job.company = summary.company_confirmed;
    if (summary.title_confirmed)   job.title   = summary.title_confirmed;
    if (summary.meta?.location && !job.location) job.location = summary.meta.location;
    await saveJobs(jobs);
    renderStats(jobs); renderJobs(jobs);
  } catch (e) {
    if (btn) { btn.textContent = T.ai_fail; btn.disabled = false; }
    console.error(e);
  }
}

async function handleInterviewPrep(jobId) {
  const url = chrome.runtime.getURL(`src/interview-prep/prep.html?jobId=${jobId}`);
  chrome.tabs.create({ url });
}

async function handleAdvance(jobId, nextStatus) {
  const jobs = await getJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  job.status = nextStatus;
  if (nextStatus === 'applied'      && !job.appliedAt)   job.appliedAt   = new Date().toISOString();
  if (nextStatus === 'interviewing' && !job.interviewAt) job.interviewAt = new Date().toISOString();
  await saveJobs(jobs);
  renderStats(jobs); renderJobs(jobs);
}

async function handleDelete(jobId) {
  const jobs = await getJobs();
  const updated = jobs.filter(j => j.id !== jobId);
  await saveJobs(updated);
  renderStats(updated); renderJobs(updated);
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.stat').forEach(el => el.classList.toggle('active', el.dataset.filter === filter));
}

function exportCSV(jobs) {
  const headers = ['Title','Company','Location','Status','Saved Date','Applied Date','URL','Summary','Skills','Highlight'];
  const rows = jobs.map(j => [
    j.summary?.title_confirmed   || j.title    || '',
    j.summary?.company_confirmed || j.company  || '',
    j.summary?.meta?.location    || j.location || '',
    j.status || '',
    j.savedAt   ? j.savedAt.slice(0, 10)   : '',
    j.appliedAt ? j.appliedAt.slice(0, 10) : '',
    j.url       || '',
    j.summary?.role_summary || '',
    (j.summary?.skills || []).join(' | '),
    j.summary?.highlight || '',
  ]);
  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `jobtracker_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Gmail Modal ───────────────────────────────────────

function openGmailModal()  { document.getElementById('gmail-overlay').classList.add('open'); }
function closeGmailModal() { document.getElementById('gmail-overlay').classList.remove('open'); }

function setGmailModalState(state, extra) {
  const body     = document.getElementById('gmail-modal-body');
  const applyBtn = document.getElementById('gmail-modal-apply');
  applyBtn.style.display = 'none';
  const spinner = '<span class="gmail-spinner">⟳</span>';
  const statusLabel = { saved:'已保存', applied:'已申请', interviewing:'面试中', offer:'Offer', rejected:'已拒绝' };

  if (state === 'auth')    { body.innerHTML = `<div class="gmail-msg">${spinner}正在请求 Gmail 授权...</div>`; }
  else if (state === 'fetch')    { body.innerHTML = `<div class="gmail-msg">${spinner}正在读取新邮件...</div>`; }
  else if (state === 'analyze')  { body.innerHTML = `<div class="gmail-msg">${spinner}AI 分析中...</div>`; }
  else if (state === 'empty')    { body.innerHTML = `<div class="gmail-msg">✓ 没有发现新的求职相关邮件</div>`; }
  else if (state === 'none')     { body.innerHTML = `<div class="gmail-msg">✓ 未发现需要更新的内容</div>`; }
  else if (state === 'error')    { body.innerHTML = `<div class="gmail-msg" style="color:#ef4444">⚠ ${extra}</div>`; }
  else if (state === 'results') {
    const { updates, newJobs, jobs } = extra;
    let html = '';
    if (updates.length) {
      html += `<div class="gmail-section-label">状态更新 · ${updates.length} 条</div>`;
      html += updates.map((u, i) => {
        const job = jobs.find(j => j.id === u.jobId);
        const company = job?.summary?.company_confirmed || job?.company || '未知公司';
        return `<div class="update-row">
          <input type="checkbox" class="update-check upd-type" id="upd-${i}" data-idx="${i}" data-kind="update" checked>
          <label for="upd-${i}" class="update-info">
            <div class="update-company">${company}</div>
            <div class="update-change">${statusLabel[job?.status] || job?.status} → ${statusLabel[u.newStatus]}</div>
            <div class="update-email">📧 ${u.emailSubject}</div>
            <div class="update-reason">${u.reason}</div>
          </label></div>`;
      }).join('');
    }
    if (newJobs.length) {
      html += `<div class="gmail-section-label" style="margin-top:${updates.length ? '10px' : '0'}">新发现的申请 · ${newJobs.length} 条</div>`;
      html += newJobs.map((nj, i) => `
        <div class="update-row">
          <input type="checkbox" class="update-check new-type" id="nj-${i}" data-idx="${i}" data-kind="new" checked>
          <label for="nj-${i}" class="update-info">
            <div class="update-company">${nj.company}</div>
            <div class="update-change" style="color:var(--text-secondary)">${nj.title} · ${statusLabel[nj.status]}</div>
            <div class="update-email">📧 ${nj.emailSubject}</div>
            <div class="update-reason">${nj.reason}</div>
          </label>
        </div>`).join('');
    }
    body.innerHTML = html;
    applyBtn.style.display = '';
    applyBtn.dataset.updates = JSON.stringify(updates);
    applyBtn.dataset.newjobs  = JSON.stringify(newJobs);
  }
}

async function handleGmailScan() {
  const apiKey = await getApiKey();
  if (!apiKey) { alert('请先在设置里填写 Claude API Key'); chrome.runtime.openOptionsPage(); return; }
  const clientId = await getGoogleClientId();
  if (!clientId) { alert('请先在设置页面配置 Google OAuth Client ID'); chrome.runtime.openOptionsPage(); return; }

  openGmailModal();
  setGmailModalState('auth');

  try {
    let token;
    try { token = await getGmailToken(clientId); }
    catch (e) { await clearGmailToken(); token = await getGmailToken(clientId); }

    setGmailModalState('fetch');
    const lastScanAt = await getLastScanAt();
    let emails;
    try { emails = await fetchJobEmails(token, lastScanAt); }
    catch (e) {
      if (e.message === 'TOKEN_EXPIRED') {
        await clearGmailToken();
        token = await getGmailToken(clientId);
        emails = await fetchJobEmails(token, lastScanAt);
      } else throw e;
    }

    const scanTime = new Date().toISOString();

    if (!emails.length) { await saveLastScanAt(scanTime); setGmailModalState('empty'); return; }

    setGmailModalState('analyze');
    const jobs = await getJobs();
    const result = await analyzeEmailsWithAI(emails, jobs, apiKey);
    await saveLastScanAt(scanTime);

    if (!result.updates.length && !result.newJobs.length) {
      setGmailModalState('none');
    } else {
      setGmailModalState('results', { updates: result.updates, newJobs: result.newJobs, jobs });
    }
  } catch (e) {
    console.error('Gmail scan error:', e);
    setGmailModalState('error', e.message || '扫描失败，请重试');
  }
}

async function applyGmailUpdates() {
  const applyBtn   = document.getElementById('gmail-modal-apply');
  const allUpdates = JSON.parse(applyBtn.dataset.updates || '[]');
  const allNewJobs = JSON.parse(applyBtn.dataset.newjobs  || '[]');
  const selectedUpdates = [], selectedNewJobs = [];

  document.querySelectorAll('.update-check:checked').forEach(el => {
    const idx = parseInt(el.dataset.idx);
    if (el.dataset.kind === 'update') { const u = allUpdates[idx]; if (u) selectedUpdates.push(u); }
    else { const nj = allNewJobs[idx]; if (nj) selectedNewJobs.push(nj); }
  });

  if (!selectedUpdates.length && !selectedNewJobs.length) { closeGmailModal(); return; }

  const jobs = await getJobs();
  for (const u of selectedUpdates) {
    const job = jobs.find(j => j.id === u.jobId);
    if (!job) continue;
    job.status = u.newStatus;
    if (u.newStatus === 'applied'      && !job.appliedAt)   job.appliedAt   = new Date().toISOString();
    if (u.newStatus === 'interviewing' && !job.interviewAt) job.interviewAt = new Date().toISOString();
  }
  for (const nj of selectedNewJobs) {
    const emailDate = nj.emailDate ? new Date(nj.emailDate) : new Date();
    const isoDate = isNaN(emailDate) ? new Date().toISOString() : emailDate.toISOString();
    jobs.push({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      title: nj.title || '未知职位', company: nj.company || '未知公司',
      location: '', description: '', url: '', domain: 'gmail',
      status: nj.status || 'applied', savedAt: isoDate,
      appliedAt: ['applied','interviewing','offer','rejected'].includes(nj.status) ? isoDate : null,
      interviewAt: nj.status === 'interviewing' ? isoDate : null,
      summary: null, applyUrl: '', source: 'gmail',
    });
  }
  await saveJobs(jobs);
  renderStats(jobs); renderJobs(jobs);
  closeGmailModal();
}

// ── Capture ───────────────────────────────────────────

async function handleCapture() {
  const btn = document.getElementById('capture-btn');
  btn.disabled = true; btn.textContent = T.saving; btn.style.opacity = '0.7';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isLinkedIn = tab.url.includes('linkedin.com');
  const isApplyPage = ['smartapply.indeed.com','apply.indeed.com','indeedapply','/apply/','apply.greenhouse.io','/job-apply'].some(p => tab.url.includes(p));

  if (isApplyPage) {
    btn.textContent = '⚠ 请在职位页面保存';
    setTimeout(() => { btn.disabled = false; btn.textContent = T.save_btn; btn.style.opacity = '1'; }, 2500);
    return;
  }

  const handleJobData = async (info) => {
    if (!info || !info.title) {
      btn.textContent = T.not_supported;
      setTimeout(() => { btn.disabled = false; btn.textContent = T.save_btn; btn.style.opacity = '1'; }, 2500);
      return;
    }
    const jobs = await getJobs();
    if (jobs.some(j => j.url === tab.url)) {
      btn.textContent = T.already_saved;
      setTimeout(() => { btn.disabled = false; btn.textContent = T.save_btn; btn.style.opacity = '1'; }, 2000);
      return;
    }
    const job = {
      id: Date.now().toString(), title: info.title || '未知职位',
      company: info.company || '', location: info.location || '',
      description: info.description || '', url: tab.url,
      domain: new URL(tab.url).hostname, status: 'saved',
      savedAt: new Date().toISOString(), summary: null, applyUrl: tab.url,
    };
    jobs.push(job);
    await saveJobs(jobs);
    renderStats(jobs); renderJobs(jobs);
    btn.style.opacity = '1'; btn.disabled = false; btn.textContent = T.saved_ok;
    setTimeout(() => { btn.textContent = T.save_btn; }, 1500);

    if (!job.company) {
      const apiKey = await getApiKey();
      if (apiKey) {
        const name = await fetchCompanyName(job, apiKey);
        if (name) {
          const allJobs = await getJobs();
          const target  = allJobs.find(j => j.id === job.id);
          if (target) { target.company = name; await saveJobs(allJobs); renderStats(allJobs); renderJobs(allJobs); }
        }
      }
    }
  };

  if (isLinkedIn) {
    chrome.tabs.sendMessage(tab.id, { action: 'CAPTURE_JOB' }, async response => {
      if (chrome.runtime.lastError || !response) {
        btn.textContent = T.not_supported;
        setTimeout(() => { btn.disabled = false; btn.textContent = T.save_btn; btn.style.opacity = '1'; }, 2500);
        return;
      }
      await handleJobData(response.job);
    });
  } else {
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabAnyPage });
      await handleJobData(results?.[0]?.result);
    } catch (e) {
      btn.textContent = T.not_supported;
      setTimeout(() => { btn.disabled = false; btn.textContent = T.save_btn; btn.style.opacity = '1'; }, 2500);
    }
  }
}

// ── Init ─────────────────────────────────────────────

async function init() {
  currentLang = await getLang();
  T = I18N[currentLang];
  applyI18n();

  const jobs = await getJobs();
  renderStats(jobs); renderJobs(jobs);

  document.querySelectorAll('.stat').forEach(el => el.addEventListener('click', async () => {
    setFilter(el.dataset.filter); renderJobs(await getJobs());
  }));

  document.querySelectorAll('.sort-btn').forEach(btn => btn.addEventListener('click', async () => {
    currentSort = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderJobs(await getJobs());
  }));

  document.getElementById('lang-btn').addEventListener('click', async () => {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    await setLang(currentLang);
    applyI18n();
    const jobs = await getJobs();
    renderStats(jobs); renderJobs(jobs);
  });

  document.getElementById('capture-btn').addEventListener('click', handleCapture);
  document.getElementById('export-btn').addEventListener('click', async () => { const jobs = await getJobs(); if (jobs.length) exportCSV(jobs); });
  document.getElementById('settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  document.getElementById('gmail-btn').addEventListener('click', handleGmailScan);
  document.getElementById('gmail-close').addEventListener('click', closeGmailModal);
  document.getElementById('gmail-modal-cancel').addEventListener('click', closeGmailModal);
  document.getElementById('gmail-modal-apply').addEventListener('click', applyGmailUpdates);
}

init();
