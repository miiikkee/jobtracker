// Gmail OAuth & API helpers for JobTracker
// All public functions are exported for use in popup and background.

export { getGmailToken, clearGmailToken, fetchJobEmails, analyzeEmailsWithAI, getLastScanAt, saveLastScanAt };

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// ── Token 管理 ────────────────────────────────────────

async function getStoredGmailToken() {
  const data = await new Promise(r =>
    chrome.storage.local.get(['gmailToken', 'gmailTokenExpiry'], r)
  );
  if (data.gmailToken && data.gmailTokenExpiry > Date.now() + 60000) {
    return data.gmailToken;
  }
  return null;
}

async function getGmailToken(clientId) {
  const cached = await getStoredGmailToken();
  if (cached) return cached;

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', GMAIL_SCOPE);
  authUrl.searchParams.set('prompt', 'consent');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'OAuth 授权被取消'));
          return;
        }
        try {
          const params = new URLSearchParams(new URL(responseUrl).hash.slice(1));
          const token = params.get('access_token');
          const expiresIn = parseInt(params.get('expires_in') || '3600');
          if (!token) throw new Error('未获取到 access_token');
          await chrome.storage.local.set({
            gmailToken: token,
            gmailTokenExpiry: Date.now() + expiresIn * 1000,
          });
          resolve(token);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function clearGmailToken() {
  await chrome.storage.local.remove(['gmailToken', 'gmailTokenExpiry']);
}

// ── 增量扫描：上次扫描时间 ────────────────────────────

async function getLastScanAt() {
  const data = await new Promise(r => chrome.storage.local.get(['gmailLastScanAt'], r));
  return data.gmailLastScanAt || null;
}

async function saveLastScanAt(isoString) {
  await chrome.storage.local.set({ gmailLastScanAt: isoString });
}

function toGmailDate(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ── 读取邮件（分页，最多 200 封）────────────────────────

async function fetchEmailMetadata(msgId, token) {
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}` +
    `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const h = {};
  (data.payload?.headers || []).forEach(hdr => { h[hdr.name] = hdr.value; });
  return {
    from:    h['From']    || '',
    subject: h['Subject'] || '',
    date:    h['Date']    || '',
    snippet: data.snippet  || '',
  };
}

async function fetchJobEmails(token, lastScanAt) {
  const keywords = [
    'interview',
    '"application received"',
    '"thank you for applying"',
    '"we received your application"',
    '"your application"',
    'offer',
    '"we regret"',
    '"unfortunately"',
    '"phone screen"',
    '"next steps"',
    '"moving forward"',
    '"background check"',
    '"job application"',
    '"application submitted"',
    '"application sent"',
  ].join(' OR ');

  // 首次扫描读 90 天；有上次记录则只读新邮件
  const timeFilter = lastScanAt ? `after:${toGmailDate(lastScanAt)}` : 'newer_than:90d';
  const q = `${timeFilter} (${keywords})`;

  // 分页拉取，最多 200 封
  const MAX = 200;
  const allMessages = [];
  let pageToken = null;

  do {
    const url = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const listRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (listRes.status === 401) throw new Error('TOKEN_EXPIRED');
    if (!listRes.ok) throw new Error(`Gmail API 错误 ${listRes.status}`);

    const listData = await listRes.json();
    allMessages.push(...(listData.messages || []));
    pageToken = listData.nextPageToken || null;
  } while (pageToken && allMessages.length < MAX);

  const messages = allMessages.slice(0, MAX);
  if (!messages.length) return [];

  // 批量拉取邮件详情（每批 10 个并发，避免请求过猛）
  const emails = [];
  const BATCH = 10;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(m => fetchEmailMetadata(m.id, token)));
    emails.push(...results.filter(Boolean));
  }

  // 精确过滤：同一天重复扫描时去掉上次扫描时间点之前的邮件
  const since = lastScanAt ? new Date(lastScanAt).getTime() : 0;
  return emails.filter(e => {
    if (!since) return true;
    const t = e.date ? new Date(e.date).getTime() : 0;
    return t > since;
  });
}

// ── AI 分析：更新现有 + 识别新职位 ───────────────────

async function analyzeEmailsWithAI(emails, jobs, apiKey) {
  const statusOrder = { saved: 0, applied: 1, interviewing: 2, offer: 3 };

  const jobList = jobs.map(j => ({
    id:      j.id,
    company: j.summary?.company_confirmed || j.company || '未知公司',
    title:   j.summary?.title_confirmed   || j.title   || '未知职位',
    status:  j.status,
  }));

  const prompt = `你是求职助手。分析以下邮件，完成两个任务：

任务1：找出与现有求职记录相关的状态更新
任务2：识别现有记录中尚未收录的新职位申请邮件

当前求职记录（已有 ${jobList.length} 条）：
${JSON.stringify(jobList, null, 2)}

邮件列表（共 ${emails.length} 封）：
${JSON.stringify(emails, null, 2)}

状态值说明：
- "applied"：收到投递确认（application received / thank you for applying / application submitted 等）
- "interviewing"：收到面试邀请（phone screen / video interview / onsite / HireVue 等）
- "offer"：收到录用 / offer 邮件
- "rejected"：收到拒信（we regret / unfortunately / will not be moving forward 等）

只输出 JSON，不要任何其他内容：
{
  "updates": [
    {
      "jobId": "job的id",
      "newStatus": "applied|interviewing|offer|rejected",
      "emailSubject": "触发此判断的邮件主题",
      "reason": "一句话说明（中文）"
    }
  ],
  "newJobs": [
    {
      "company": "公司名",
      "title": "职位名称",
      "status": "applied|interviewing|offer|rejected",
      "emailSubject": "来源邮件主题",
      "emailDate": "邮件日期（原始字符串）",
      "reason": "一句话说明（中文）"
    }
  ]
}

规则：
- updates：只包含高置信度匹配；不降级现有状态（rejected 除外）；新状态与当前相同则跳过
- newJobs：邮件明确显示求职申请或回复，且在现有记录中找不到匹配的公司+职位；必须能从邮件中提取出公司名和职位名
- 匹配判断用模糊匹配（忽略大小写、子串包含即算匹配）`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const raw = (data.content?.[0]?.text || '{"updates":[],"newJobs":[]}')
    .replace(/```json|```/g, '')
    .trim();

  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    // JSON 被截断时，提取已完整的元素
    result = { updates: [], newJobs: [] };
    const extractArray = (key) => {
      const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(\\[.*?)(?=,\\s*"\\w+"|$)`, 's'));
      if (!match) return [];
      try {
        const fixed = match[1].replace(/,?\s*\{[^}]*$/, '') + ']';
        return JSON.parse(fixed);
      } catch (_) { return []; }
    };
    result.updates = extractArray('updates');
    result.newJobs = extractArray('newJobs');
  }

  // 过滤 updates：不降级状态
  const filteredUpdates = (result.updates || []).filter(u => {
    const job = jobs.find(j => j.id === u.jobId);
    if (!job) return false;
    if (u.newStatus === job.status) return false;
    if (u.newStatus !== 'rejected') {
      if ((statusOrder[u.newStatus] ?? 0) <= (statusOrder[job.status] ?? 0)) return false;
    }
    return true;
  });

  // 过滤 newJobs：与现有职位去重（模糊匹配）
  const filteredNewJobs = (result.newJobs || []).filter(nj => {
    if (!nj.company || !nj.title) return false;
    const njCompany = nj.company.toLowerCase();
    const njTitle   = nj.title.toLowerCase();
    return !jobs.some(j => {
      const jCompany = (j.summary?.company_confirmed || j.company || '').toLowerCase();
      const jTitle   = (j.summary?.title_confirmed   || j.title   || '').toLowerCase();
      const companyMatch = jCompany && njCompany &&
        (jCompany.includes(njCompany) || njCompany.includes(jCompany));
      const titleMatch = jTitle && njTitle &&
        (jTitle.includes(njTitle) || njTitle.includes(jTitle));
      return companyMatch && titleMatch;
    });
  });

  return { updates: filteredUpdates, newJobs: filteredNewJobs };
}
