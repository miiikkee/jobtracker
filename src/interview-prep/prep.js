import { getJobs, saveJobs, getApiKey, getLang, setLang, getResume } from '../utils/storage.js';
import { analyzeJD, predictInterviewStructure, generateInterviewQuestions, analyzeResumeVsJD, generateOAPrep } from '../utils/ai.js';

// ── Init ──────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(location.search);
  const jobId  = params.get('jobId');

  const jobs = await getJobs();
  const job  = jobs.find(j => j.id === jobId);

  if (!job) {
    document.getElementById('header-company').textContent = 'Job not found';
    document.getElementById('loading-view').style.display = 'none';
    return;
  }

  // Header
  document.getElementById('header-company').textContent =
    job.summary?.company_confirmed || job.company || 'Unknown Company';
  document.getElementById('header-meta').innerHTML = `
    <span>${job.summary?.title_confirmed || job.title || ''}</span>
    ${job.location ? `<span>· ${job.location}</span>` : ''}
    <span class="status-chip">${statusLabel(job.status)}</span>
  `;

  // Back button
  document.getElementById('back-btn').addEventListener('click', () => window.close());

  // Language toggle — switch lang, clear cache, regenerate
  const currentLangVal = await getLang();
  const langBtn = document.getElementById('lang-btn');
  langBtn.textContent = currentLangVal === 'zh' ? 'EN' : '中';
  langBtn.title = currentLangVal === 'zh' ? 'Switch to English' : '切换为中文';
  langBtn.addEventListener('click', async () => {
    const lang = await getLang();
    const newLang = lang === 'zh' ? 'en' : 'zh';
    await setLang(newLang);
    // Clear cached prep data so it regenerates in new language
    const allJobs = await getJobs();
    const t = allJobs.find(j => j.id === jobId);
    if (t) { delete t.prepData; await saveJobs(allJobs); }
    location.reload();
  });

  // Regenerate button
  document.getElementById('regen-btn').addEventListener('click', async () => {
    const allJobs = await getJobs();
    const t = allJobs.find(j => j.id === jobId);
    if (t) { delete t.prepData; await saveJobs(allJobs); }
    location.reload();
  });

  // Nav tabs
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // Use cached data only if it has actual content
  if (job.prepData && isValidPrepData(job.prepData)) {
    renderAll(job.prepData, job);
    return;
  }

  // Run fresh analysis
  const apiKey = await getApiKey();
  if (!apiKey) {
    showError('Please set your Claude API Key in Settings first.');
    return;
  }

  await runAnalysis(job, apiKey, jobs);
}

function isValidPrepData(data) {
  if (!data) return false;
  if (!Array.isArray(data.questions?.behavioral) || data.questions.behavioral.length === 0) return false;
  if (!Array.isArray(data.questions?.technical)  || data.questions.technical.length  === 0) return false;
  // Invalidate cache from before OA prep feature was added
  if (data.structure?.oa?.likely && !('oaPrep' in data)) return false;
  return true;
}

// ── Analysis pipeline ─────────────────────────────────

async function runAnalysis(job, apiKey, jobs) {
  const lang   = await getLang();
  const resume = await getResume();

  setStep(1, 'active');
  setProgress(5);

  let jdAnalysis;
  try {
    jdAnalysis = await analyzeJD(job, apiKey);
  } catch (e) {
    showError(`JD analysis failed: ${e.message}`); return;
  }

  setStep(1, 'done'); setStep(2, 'active'); setProgress(30);

  const structure = await predictInterviewStructure(jdAnalysis, job);

  setStep(2, 'done'); setStep(3, 'active'); setProgress(50);

  let questions, oaPrep = null;
  {
    const [qRes, oaRes] = await Promise.allSettled([
      generateInterviewQuestions(jdAnalysis, structure, job, apiKey, lang, resume),
      structure.oa?.likely ? generateOAPrep(jdAnalysis, job, apiKey, lang) : Promise.resolve(null),
    ]);
    if (qRes.status === 'rejected') { showError(`Question generation failed: ${qRes.reason.message}`); return; }
    questions = qRes.value;
    oaPrep    = oaRes.status === 'fulfilled' ? oaRes.value : null;
  }

  // Resume analysis (optional Pass 4)
  let resumeAnalysis = null;
  if (resume) {
    setStep(3, 'done'); setStep(4, 'active'); setProgress(85);
    try { resumeAnalysis = await analyzeResumeVsJD(job, jdAnalysis, resume, apiKey, lang); }
    catch (_) {}
  }

  setProgress(100);

  const prepData = { jdAnalysis, structure, questions, oaPrep, resumeAnalysis, generatedAt: new Date().toISOString() };

  // Cache
  const allJobs = await getJobs();
  const target  = allJobs.find(j => j.id === job.id);
  if (target) { target.prepData = prepData; await saveJobs(allJobs); }

  renderAll(prepData, job);
}

// ── Render ────────────────────────────────────────────

function renderAll({ jdAnalysis, structure, questions, oaPrep, resumeAnalysis }, job) {
  document.getElementById('loading-view').style.display = 'none';
  document.getElementById('content-view').style.display = '';

  renderOverview(jdAnalysis, structure, resumeAnalysis);
  renderHR(questions.hr_round || {});
  renderBehavioral(questions.behavioral || [], resumeAnalysis);
  renderTechnical(questions.technical || []);
  renderOA(structure?.oa || {}, jdAnalysis, oaPrep);
  renderReverse(questions.hr_round?.reverse_questions || {});
}

function renderOverview(jd, structure, resumeAnalysis) {
  const tab = document.getElementById('tab-overview');

  const roundsHtml = (structure?.rounds || []).map((r, i) => `
    <div class="round-item">
      <div class="round-num">${i + 1}</div>
      <div>
        <div class="round-name">${r.name}</div>
        <div class="round-meta">${r.format} · ${r.duration}</div>
        <div class="round-tags">${(r.focus || []).map(f => `<span class="round-tag">${f}</span>`).join('')}</div>
      </div>
    </div>`).join('');

  const reqSkills  = (jd?.required_skills  || []).map(s => `<span class="skill-tag required">${s}</span>`).join('');
  const niceSkills = (jd?.nice_to_have     || []).map(s => `<span class="skill-tag">${s}</span>`).join('');

  const resumeCard = resumeAnalysis ? `
    <div class="section">
      <div class="section-title">Resume Match Analysis</div>
      <div class="card" style="border-left: 3px solid ${resumeAnalysis.match_score >= 70 ? 'var(--accent)' : resumeAnalysis.match_score >= 50 ? 'var(--amber)' : 'var(--red)'}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="font-size:28px;font-weight:700;color:${resumeAnalysis.match_score >= 70 ? 'var(--accent)' : resumeAnalysis.match_score >= 50 ? 'var(--amber)' : 'var(--red)'}">${resumeAnalysis.match_score}%</div>
          <div class="card-tip">${resumeAnalysis.advice}</div>
        </div>
        ${resumeAnalysis.strengths?.length ? `
          <div class="section-title" style="margin-bottom:6px">Your Strengths</div>
          ${resumeAnalysis.strengths.map(s => `<div class="card-tip" style="margin-bottom:4px">✓ ${s}</div>`).join('')}` : ''}
        ${resumeAnalysis.gaps?.length ? `
          <div class="section-title" style="margin-top:10px;margin-bottom:6px">Gaps to Address</div>
          ${resumeAnalysis.gaps.map(g => `<div class="card-tip" style="margin-bottom:4px">△ ${g}</div>`).join('')}` : ''}
      </div>
    </div>` : `
    <div class="section">
      <div class="section-title">Resume (Optional)</div>
      <div class="card" style="border-style:dashed;text-align:center;cursor:pointer" id="resume-prompt">
        <div style="font-size:20px;margin-bottom:6px">📄</div>
        <div class="card-tip">Add your resume in Settings for personalized STAR hints and match analysis</div>
      </div>
    </div>`;

  tab.innerHTML = `
    <div class="section">
      <div class="section-title">Role Profile</div>
      <div class="card" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div>
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">Category</div>
          <div style="font-weight:600">${jd?.role_category || '—'}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">Seniority</div>
          <div style="font-weight:600">${jd?.seniority || '—'}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">Timeline</div>
          <div style="font-weight:600">${structure?.timeline_days || '2-4 weeks'}</div>
        </div>
      </div>
    </div>

    ${resumeCard}

    <div class="section">
      <div class="section-title">Interview Process · ${structure?.total_rounds || '?'} Rounds</div>
      <div class="rounds-list">${roundsHtml || '<div class="card-tip">No rounds data available.</div>'}</div>
    </div>

    ${reqSkills ? `<div class="section">
      <div class="section-title">Required Skills</div>
      <div class="skills-grid">${reqSkills}</div>
      ${niceSkills ? `<div class="skills-grid" style="margin-top:8px">${niceSkills}</div>` : ''}
    </div>` : ''}

    ${jd?.culture_signals?.length ? `<div class="section">
      <div class="section-title">Culture Signals</div>
      <div class="skills-grid">${jd.culture_signals.map(s => `<span class="skill-tag">${s}</span>`).join('')}</div>
    </div>` : ''}
  `;

  document.getElementById('resume-prompt')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderHR(hr) {
  const tab = document.getElementById('tab-hr');
  const selfIntro = hr.self_intro ? `
    <div class="section">
      <div class="section-title">Self Introduction</div>
      <div class="intro-box">
        <div class="intro-framework">Framework: ${hr.self_intro.framework || 'Past → Strengths → Why this role'}</div>
        <ul class="intro-tips">
          ${(hr.self_intro.tips || []).map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>
    </div>` : '';

  const motivation = renderQCards(hr.motivation || [], 'Motivation & Fit');
  const logistics  = renderQCards(hr.logistics  || [], 'Logistics & Background');

  const content = selfIntro + motivation + logistics;
  tab.innerHTML = content || '<div class="empty">HR questions not generated yet. Click Regenerate.</div>';
}

function renderBehavioral(questions, resumeAnalysis) {
  const tab = document.getElementById('tab-behavioral');
  if (!questions.length) {
    tab.innerHTML = '<div class="empty">No behavioral questions generated. Click Regenerate.</div>';
    return;
  }

  // Talking points from resume analysis
  const talkingPoints = resumeAnalysis?.talking_points || [];

  tab.innerHTML = `
    <div class="section">
      <div class="section-title">Use the STAR Framework — ${questions.length} Questions</div>
      ${talkingPoints.length ? `
        <div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent)">
          <div class="card-q" style="margin-bottom:8px">📄 Your Resume Talking Points</div>
          ${talkingPoints.map(tp => `
            <div style="margin-bottom:6px">
              <div class="card-tip" style="color:var(--accent)">→ ${tp.experience}</div>
              <div class="card-tip" style="margin-left:12px">maps to: ${tp.maps_to}</div>
            </div>`).join('')}
        </div>` : ''}
      ${questions.map(q => `
        <div class="card">
          <div class="card-category">${q.competency || ''}</div>
          <div class="card-q">${q.q}</div>
          ${q.star_hints ? `
            <div class="star-grid">
              <div class="star-label">S</div><div class="card-tip">${q.star_hints.S || ''}</div>
              <div class="star-label">T</div><div class="card-tip">${q.star_hints.T || ''}</div>
              <div class="star-label">A</div><div class="card-tip">${q.star_hints.A || ''}</div>
              <div class="star-label">R</div><div class="card-tip">${q.star_hints.R || ''}</div>
            </div>` : ''}
          ${q.resume_hook ? `<div class="card-tip" style="margin-top:8px;color:var(--accent);border-top:1px solid var(--border);padding-top:8px">📄 Draw from: ${q.resume_hook}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function renderTechnical(questions) {
  const tab = document.getElementById('tab-technical');
  if (!questions.length) {
    tab.innerHTML = '<div class="empty">No technical questions generated. Click Regenerate.</div>';
    return;
  }

  const byCategory = {};
  questions.forEach(q => {
    const cat = q.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(q);
  });

  tab.innerHTML = Object.entries(byCategory).map(([cat, qs]) => `
    <div class="section">
      <div class="section-title">${cat}</div>
      ${qs.map(q => `
        <div class="card">
          <span class="card-difficulty diff-${q.difficulty || 'Medium'}">${q.difficulty || 'Medium'}</span>
          <div class="card-q">${q.q}</div>
          ${q.key_points?.length ? `
            <ul style="margin-top:8px;padding-left:16px">
              ${q.key_points.map(p => `<li class="card-tip" style="margin-bottom:3px">${p}</li>`).join('')}
            </ul>` : ''}
        </div>`).join('')}
    </div>`).join('');
}

function renderOA(oa, jd, oaPrep) {
  const tab = document.getElementById('tab-oa');
  if (!oa.likely) {
    tab.innerHTML = `
      <div class="section">
        <div class="section-title">Online Assessment</div>
        <div class="card">
          <div class="card-q">OA is unlikely for this role.</div>
          <div class="card-tip">This role typically goes straight to interviews. Focus on the Behavioral and Technical tabs.</div>
        </div>
      </div>`;
    return;
  }

  const topicTags = (oa.topics || []).map(t => `<span class="skill-tag required">${t}</span>`).join('');

  const topicWeightsHtml = oaPrep?.topic_weights?.length ? `
    <div class="section">
      <div class="section-title">Topic Priority</div>
      ${oaPrep.topic_weights.map(tw => `
        <div class="topic-weight-item">
          <div class="topic-weight-header">
            <span class="topic-name">${tw.topic}</span>
            <span class="weight-badge weight-${tw.weight}">${tw.weight}</span>
          </div>
          <div class="card-tip">${tw.reason}</div>
        </div>`).join('')}
    </div>` : '';

  const lcHtml = oaPrep?.leetcode_recommendations?.length ? `
    <div class="section">
      <div class="section-title">LeetCode Recommendations · ${oaPrep.leetcode_recommendations.length} Problems</div>
      ${oaPrep.company_patterns ? `<div class="card-tip" style="margin-bottom:14px">${oaPrep.company_patterns}</div>` : ''}
      ${oaPrep.leetcode_recommendations.map(p => `
        <div class="lc-card">
          <div class="lc-header">
            <a href="${p.url}" target="_blank" class="lc-link">#${p.id} ${p.name}</a>
            <span class="card-difficulty diff-${p.difficulty}">${p.difficulty}</span>
          </div>
          <div class="lc-meta">
            <span class="pattern-tag">${p.pattern}</span>
            <span class="card-tip">${p.reason}</span>
          </div>
        </div>`).join('')}
    </div>` : '';

  const genProblemsHtml = oaPrep?.generated_problems?.length ? `
    <div class="section">
      <div class="section-title">AI-Generated Practice Problems</div>
      ${oaPrep.generated_problems.map(p => `
        <div class="gen-problem-card">
          <div class="gen-problem-header" onclick="this.parentElement.classList.toggle('open')">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="card-difficulty diff-${p.difficulty}">${p.difficulty}</span>
              <span class="gen-problem-title">${p.title}</span>
              <span class="pattern-tag">${p.pattern}</span>
            </div>
            <span class="expand-icon">▾</span>
          </div>
          <div class="gen-problem-body">
            <div class="gen-problem-section">
              <div class="gen-label">Problem</div>
              <div class="card-tip">${p.description}</div>
            </div>
            <div class="gen-two-col">
              <div>
                <div class="gen-label">Example Input</div>
                <code class="gen-code">${p.example_input}</code>
              </div>
              <div>
                <div class="gen-label">Expected Output</div>
                <code class="gen-code">${p.example_output}</code>
              </div>
            </div>
            <div class="gen-problem-section">
              <div class="gen-label">Constraints</div>
              <div class="card-tip">${p.constraints}</div>
            </div>
            <div class="gen-problem-section hint-box">
              <div class="gen-label" style="color:var(--accent)">Hint</div>
              <div class="card-tip">${p.hint}</div>
            </div>
          </div>
        </div>`).join('')}
    </div>` : '';

  const strategyHtml = `
    <div class="section">
      <div class="section-title">Strategy</div>
      <div class="card">
        <div class="card-q">Time Management</div>
        <div class="card-tip">${oaPrep?.time_strategy || 'Read both problems first (5 min). Solve the easier one first. Leave 10 min to review edge cases.'}</div>
      </div>
      ${oaPrep?.common_mistakes?.length ? `
        <div class="card">
          <div class="card-q">Common Mistakes to Avoid</div>
          <ul style="margin-top:8px;padding-left:16px">
            ${oaPrep.common_mistakes.map(m => `<li class="card-tip" style="margin-bottom:4px">${m}</li>`).join('')}
          </ul>
        </div>` : ''}
      <div class="card">
        <div class="card-q">⚠ Reminder</div>
        <div class="card-tip">Most OAs have NDAs. Only practice from publicly shared resources. These generated problems are original and safe to use.</div>
      </div>
    </div>`;

  tab.innerHTML = `
    <div class="section">
      <div class="section-title">OA Overview</div>
      <div class="oa-grid">
        <div class="oa-stat"><div class="oa-stat-label">Platform</div><div class="oa-stat-value">${oa.platform || 'TBD'}</div></div>
        <div class="oa-stat"><div class="oa-stat-label">Duration</div><div class="oa-stat-value">${oa.duration || '90 min'}</div></div>
        <div class="oa-stat"><div class="oa-stat-label">Problems</div><div class="oa-stat-value">${oa.problem_count || 2}</div></div>
        <div class="oa-stat"><div class="oa-stat-label">Difficulty</div><div class="oa-stat-value">${oa.difficulty || 'Medium'}</div></div>
      </div>
      ${topicTags ? `<div class="section-title" style="margin-top:16px">Likely Topics</div><div class="skills-grid" style="margin-top:10px">${topicTags}</div>` : ''}
    </div>
    ${topicWeightsHtml}
    ${lcHtml}
    ${genProblemsHtml}
    ${strategyHtml}
  `;
}

function renderReverse(reverseQ) {
  const tab = document.getElementById('tab-reverse');
  const sections = [
    { key: 'for_hr',             title: 'Ask the Recruiter / HR' },
    { key: 'for_hiring_manager', title: 'Ask the Hiring Manager' },
    { key: 'for_team',           title: 'Ask Teammates / Peers' },
  ];

  const content = sections.map(s => {
    const qs = reverseQ[s.key] || [];
    if (!qs.length) return '';
    return `
      <div class="reverse-section">
        <div class="reverse-title">${s.title}</div>
        <ul class="reverse-list">${qs.map(q => `<li>${q}</li>`).join('')}</ul>
      </div>`;
  }).join('');

  tab.innerHTML = `
    <div class="section">
      <div class="section-title">Questions to Ask — show curiosity and preparation</div>
      ${content || '<div class="empty">No questions generated. Click Regenerate.</div>'}
    </div>`;
}

// ── Helpers ───────────────────────────────────────────

function renderQCards(questions, sectionTitle) {
  if (!questions.length) return '';
  return `
    <div class="section">
      <div class="section-title">${sectionTitle}</div>
      ${questions.map(q => `
        <div class="card">
          <div class="card-q">${q.q}</div>
          ${q.tip ? `<div class="card-tip">💡 ${q.tip}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });
  document.querySelectorAll('[id^="tab-"]').forEach(el => {
    el.style.display = el.id === `tab-${tabName}` ? '' : 'none';
  });
}

function setStep(n, state) {
  const el = document.getElementById(`step-${n}`);
  if (!el) return;
  el.style.opacity = '1';
  if (state === 'done') {
    el.className = 'loading-step done';
    el.querySelector('.step-icon').textContent = '✓';
  } else if (state === 'active') {
    el.className = 'loading-step active';
    el.querySelector('.step-icon').innerHTML = '<span class="spinner">⟳</span>';
  }
}

function setProgress(pct) {
  const el = document.getElementById('progress-fill');
  if (el) el.style.width = `${pct}%`;
}

function showError(msg) {
  document.getElementById('loading-view').innerHTML =
    `<div class="empty" style="color:var(--red)">⚠ ${msg}</div>`;
}

function statusLabel(s) {
  return { saved:'Saved', applied:'Applied', interviewing:'Interviewing', offer:'Offer', rejected:'Rejected' }[s] || s;
}

init();
