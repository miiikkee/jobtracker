// content.js v2.1 — 基于真实 DOM 调试结果
//
// 调试确认的事实（2025-03）：
// 1. LinkedIn 搜索列表页：无 JSON-LD，标题在 .job-details-jobs-unified-top-card__job-title
// 2. 公司名：aria-label="Company, X." 无障碍属性，面板动态渲染，需等待
// 3. JD 容器：#job-details 在搜索页不存在，降级到最大文本块
// 4. data-testid="toasts-title" 是通知元素，不是职位标题，不可用
//
// 抓取策略：
// - LinkedIn 搜索页：MutationObserver 等 aria-label^="Company," 出现后再抓
// - LinkedIn 详情页：优先 JSON-LD，降级 DOM
// - 其他平台：各自专属 selector

// ── 工具 ─────────────────────────────────────────────

function cap(t, n = 4000) {
  return (t || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function firstText(...sels) {
  for (const s of sels) {
    const t = document.querySelector(s)?.innerText?.trim();
    if (t) return t;
  }
  return '';
}

// ── JSON-LD（仅用于 LinkedIn 详情页 / Indeed / ATS）────

function extractFromJsonLd() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const jobs = item['@type'] === 'JobPosting' ? [item]
          : (item['@graph'] || []).filter(n => n['@type'] === 'JobPosting');
        for (const job of jobs) {
          if (!job.title) continue;
          return {
            title:       job.title.trim(),
            company:     job.hiringOrganization?.name?.trim() || '',
            location:    [job.jobLocation?.address?.addressLocality,
                          job.jobLocation?.address?.addressRegion]
                          .filter(Boolean).join(', '),
            description: cap(job.description?.replace(/<[^>]+>/g, ' ') || ''),
            source: 'json-ld',
          };
        }
      }
    } catch (e) {}
  }
  return null;
}

// ── LinkedIn DOM 抓取（调试后的精确 selector）────────────

function extractLinkedInNow() {
  // 公司名：aria-label="Company, X." — 调试确认存在且稳定
  const companyEl = document.querySelector('[aria-label^="Company,"]');
  const company = companyEl
    ? companyEl.getAttribute('aria-label').replace(/^Company,\s*/i, '').replace(/\.$/, '').trim()
    : firstText('a[href*="linkedin.com/company/"]');

  // 标题：用 v1.1 确认有效的 selector，不用 data-testid（会命中通知元素）
  const title = firstText(
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title h2',
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title h2',
    '.t-24.t-bold.inline',
    'h1.t-24',
    'h1',
  );

  // 地点：这个类名在两种页面都出现过
  const location = firstText(
    '.job-details-jobs-unified-top-card__bullet',
    '.jobs-unified-top-card__bullet',
    '[class*="topcard__flavor--bullet"]',
  );

  // JD：#job-details 在搜索页不存在，用更宽的 selector
  const descEl =
    document.querySelector('#job-details') ||
    document.querySelector('.jobs-description__content') ||
    document.querySelector('[class*="jobs-description"]') ||
    document.querySelector('[class*="job-description"]') ||
    // 兜底：找右侧详情面板里最大的文本块
    (() => {
      const detail = document.querySelector('[data-job-id]') ||
                     document.querySelector('.scaffold-layout__detail') ||
                     document.querySelector('main');
      if (!detail) return null;
      // 在详情区域里找最长的 div/section
      let best = null, bestLen = 0;
      detail.querySelectorAll('div, section, article').forEach(el => {
        const t = el.innerText?.trim();
        if (t && t.length > bestLen && t.length < 15000) {
          best = el; bestLen = t.length;
        }
      });
      return best;
    })();

  const description = cap(descEl?.innerText || '');

  // document.title 兜底：格式 "职位名 | 公司名 | LinkedIn"，永远存在
  let finalTitle = title;
  let finalCompany = company;
  if (!finalTitle || !finalCompany) {
    const parts = document.title.split('|').map(s => s.trim());
    // parts[0]=职位名, parts[1]=公司名, parts[2]="LinkedIn"
    if (!finalTitle   && parts[0] && parts[0] !== 'LinkedIn') finalTitle   = parts[0];
    if (!finalCompany && parts[1] && parts[1] !== 'LinkedIn') finalCompany = parts[1];
  }

  return { title: finalTitle, company: finalCompany, location, description, source: 'linkedin-dom' };
}

// ── 等待 LinkedIn 面板渲染完成 ─────────────────────────
// 条件：aria-label^="Company," 出现 且 标题元素出现

function waitForLinkedIn(timeout = 5000) {
  return new Promise(resolve => {
    function check() {
      // 只等 LinkedIn 专属类名出现——这些类名只存在于右侧详情面板
      // 不用通用 h1/h2，否则搜索页左侧列表的标题会立刻触发导致抓空
      const panelReady = !!(
        document.querySelector('.job-details-jobs-unified-top-card__job-title') ||
        document.querySelector('.jobs-unified-top-card__job-title') ||
        document.querySelector('h1.t-24') ||
        document.querySelector('.t-24.t-bold.inline')
      );
      if (panelReady) return extractLinkedInNow();
      return null;
    }

    const immediate = check();
    if (immediate) return resolve(immediate);

    const observer = new MutationObserver(() => {
      const result = check();
      if (result) { observer.disconnect(); clearTimeout(timer); resolve(result); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      // 超时后无论如何都尝试抓一次
      resolve(extractLinkedInNow());
    }, timeout);
  });
}

// ── 其他平台（selector 相对稳定）────────────────────────

function extractWorkday() {
  return {
    title:       firstText('[data-automation-id="jobPostingHeader"]', 'h2', 'h1'),
    company:     firstText('[data-automation-id="orgName"]'),
    location:    firstText('[data-automation-id="locations"]'),
    description: cap(document.querySelector('[data-automation-id="jobPostingDescription"]')?.innerText || ''),
    source: 'workday',
  };
}

function extractGreenhouse() {
  return {
    title:       firstText('h1.app-title', 'h1'),
    company:     firstText('.company-name'),
    location:    firstText('.location'),
    description: cap(document.querySelector('#content')?.innerText || ''),
    source: 'greenhouse',
  };
}

function extractLever() {
  return {
    title:       firstText('.posting-headline h2', 'h2'),
    company:     document.querySelector('.main-header-logo img')?.alt?.trim() || '',
    location:    firstText('.sort-by-time.posting-category', '.location'),
    description: cap(document.querySelector('.posting-description')?.innerText || ''),
    source: 'lever',
  };
}

function extractIndeed() {
  // Indeed 有 JSON-LD，优先走上层，这里作为降级
  return {
    title:       firstText('[data-testid="jobsearch-JobInfoHeader-title"]', 'h1'),
    company:     firstText('[data-testid="inlineHeader-companyName"]'),
    location:    firstText('[data-testid="job-location"]'),
    description: cap(document.querySelector('#jobDescriptionText')?.innerText || ''),
    source: 'indeed',
  };
}

function extractGeneric() {
  // document.title 格式通常是 "职位名 | 公司名 | 平台" 或 "职位名 - 公司名"
  const titleParts = document.title.split(/[|\-–]/).map(s => s.trim()).filter(Boolean);
  const title   = document.querySelector('h1')?.innerText?.trim() || titleParts[0] || '';
  const company = titleParts.length >= 2 ? titleParts[1] : '';

  // 优先取语义化容器，避免导航/footer 噪音
  const descEl =
    document.querySelector('main [class*="description"]') ||
    document.querySelector('main [class*="content"]') ||
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[class*="description"]') ||
    document.querySelector('[class*="job-detail"]');

  const desc = descEl?.innerText?.trim() || '';
  // 超过 500 字才认为是有效 JD，否则用 body 兜底
  const description = cap(desc.length > 500 ? desc : document.body.innerText);

  return { title, company, location: '', description, source: 'generic' };
}

// ── 主入口 ────────────────────────────────────────────

async function extract() {
  const host = window.location.hostname;

  // Greenhouse / Lever：结构固定，直接抓
  if (host.includes('greenhouse.io')) return extractGreenhouse();
  if (host.includes('lever.co'))      return extractLever();

  // LinkedIn：搜索页无 JSON-LD，直接走 DOM 等待逻辑
  if (host.includes('linkedin.com'))  return await waitForLinkedIn();

  // 其他平台：先试 JSON-LD，没有再走专属 selector
  const jsonLd = extractFromJsonLd();
  if (jsonLd?.title) return jsonLd;

  if (host.includes('workday') || host.includes('myworkdayjobs')) return extractWorkday();
  if (host.includes('indeed.com'))   return extractIndeed();

  return extractGeneric();
}

// ── 消息监听 ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'CAPTURE_JOB') {
    extract().then(info => {
      sendResponse({
        job: {
          id:          Date.now().toString(),
          title:       info.title       || '未知职位',
          company:     info.company     || '',
          location:    info.location    || '',
          description: info.description || '',
          url:         window.location.href,  // 一键申请就用这个 URL
          domain:      window.location.hostname,
          status:      'saved',
          savedAt:     new Date().toISOString(),
          summary:     null,
        },
      });
    });
  }
  return true;
});
