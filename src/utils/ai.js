// All Claude API calls

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-haiku-4-5-20251001';

function claudeHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

async function callClaude(apiKey, prompt, maxTokens = 800) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: claudeHeaders(apiKey),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

function parseJSON(text, fallback = {}) {
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (_) {
    return fallback;
  }
}

// ── 保存时自动补公司名 ─────────────────────────────────

export async function fetchCompanyName(job, apiKey) {
  if (!apiKey) return null;
  const text = await callClaude(apiKey,
    `从以下职位描述中提取公司名，只输出公司名本身，找不到则输出空字符串。\n\n${job.description.slice(0, 1500)}`,
    50
  );
  if (!text || text.length > 60 || text.length < 2) return null;
  return text;
}

// ── AI 摘要 ────────────────────────────────────────────

export async function summarizeJob(job, apiKey, lang = 'zh') {
  const langInstr = lang === 'zh' ? '所有字段用简体中文输出' : 'Output all fields in English';
  const prompt = `你是一个求职助手。请分析以下职位信息，${langInstr}。只输出 JSON，不要任何其他内容：
{
  "title_confirmed": "从JD正文确认的职位名",
  "company_confirmed": "从JD正文提取的公司名（最重要）",
  "company_intro": "公司背景一句话",
  "role_summary": "职位核心职责一句话",
  "meta": { "location": "地点", "salary": null, "work_mode": "Remote/Hybrid/On-site" },
  "requirements": ["硬性要求1", "硬性要求2", "硬性要求3"],
  "responsibilities": ["核心职责1", "核心职责2", "核心职责3"],
  "skills": ["技能1", "技能2", "技能3", "技能4"],
  "highlight": "最值得关注的一点"
}

职位名：${job.title}
公司名：${job.company || '（请从JD提取）'}
地点：${job.location || '（请从JD提取）'}
JD正文：${job.description}`;

  const text = await callClaude(apiKey, prompt, 800);
  return parseJSON(text);
}

// ── Pass 1：JD 深度解析 ───────────────────────────────

export async function analyzeJD(job, apiKey) {
  const prompt = `你是专业的求职顾问。分析以下 JD，只输出 JSON，不要任何其他内容：
{
  "role_category": "SWE|Finance|PM|DataScience|Consulting|Marketing|Sales|Other",
  "seniority": "Intern|Entry|Mid|Senior|Staff|Manager|Director",
  "technical_depth": "high|medium|low",
  "required_skills": ["skill1", "skill2"],
  "nice_to_have": ["skill1"],
  "key_responsibilities": ["resp1", "resp2", "resp3"],
  "culture_signals": ["fast-paced", "data-driven"],
  "interview_focus": {
    "technical": ["topic1", "topic2"],
    "behavioral": ["competency1", "competency2"],
    "domain": ["domain_topic1"]
  },
  "company_stage": "startup|growth|public|BigTech|Unknown"
}

公司：${job.company}
职位：${job.title}
JD：${job.description.slice(0, 3000)}`;

  const text = await callClaude(apiKey, prompt, 1000);
  return parseJSON(text, { role_category: 'Other', seniority: 'Mid', technical_depth: 'medium',
    required_skills: [], nice_to_have: [], key_responsibilities: [],
    culture_signals: [], interview_focus: { technical: [], behavioral: [], domain: [] },
    company_stage: 'Unknown' });
}

// ── Pass 2：面试流程预测 ──────────────────────────────

export async function predictInterviewStructure(jdAnalysis, job) {
  // 根据角色类型给出合理的默认结构，无需额外 API 调用
  const isSWE     = jdAnalysis.role_category === 'SWE';
  const isFinance = jdAnalysis.role_category === 'Finance';
  const isPM      = jdAnalysis.role_category === 'PM';
  const isBigTech = jdAnalysis.company_stage === 'BigTech';

  const baseRounds = [
    { name: 'Recruiter Screen',    type: 'HR',         format: 'Phone/Video', duration: '30 min',
      focus: ['background', 'motivation', 'salary', 'visa/timeline'] },
    { name: 'Hiring Manager Chat', type: 'Behavioral', format: 'Video',       duration: '45 min',
      focus: ['leadership principles', 'role fit', 'team dynamics'] },
  ];

  if (isSWE) {
    baseRounds.push(
      { name: 'Technical Screen', type: 'Technical', format: 'Video + CodePad', duration: '60 min',
        focus: ['Data Structures & Algorithms', 'coding fluency'] },
    );
    if (isBigTech) {
      baseRounds.push(
        { name: 'Onsite / Virtual Onsite', type: 'Loop', format: 'Video (×4-5)', duration: '4-5 hrs',
          focus: ['Algorithms', 'System Design', 'Behavioral (LP)', 'Bar Raiser'] },
      );
    } else {
      baseRounds.push(
        { name: 'Final Interview', type: 'Loop', format: 'Video (×2-3)', duration: '2-3 hrs',
          focus: ['Algorithms', 'System Design', 'Culture Fit'] },
      );
    }
  } else if (isFinance) {
    baseRounds.push(
      { name: 'Technical Interview', type: 'Technical', format: 'Video', duration: '45 min',
        focus: ['Valuation', 'Financial Modeling', 'Brain Teasers', 'Market Knowledge'] },
      { name: 'Superday', type: 'Loop', format: 'In-person (×4-6)', duration: '3-4 hrs',
        focus: ['Technical', 'Behavioral', 'Deal Discussion', 'Culture Fit'] },
    );
  } else if (isPM) {
    baseRounds.push(
      { name: 'PM Interview', type: 'Technical', format: 'Video', duration: '60 min',
        focus: ['Product Sense', 'Metrics & Analytics', 'Execution'] },
      { name: 'Final Round', type: 'Loop', format: 'Video (×3-4)', duration: '3 hrs',
        focus: ['Product Design', 'Strategy', 'Leadership', 'Technical Depth'] },
    );
  } else {
    baseRounds.push(
      { name: 'Final Round', type: 'Loop', format: 'Video/In-person (×2-3)', duration: '2-3 hrs',
        focus: ['Domain Knowledge', 'Case Study', 'Culture Fit'] },
    );
  }

  const oaLikely = isSWE && (jdAnalysis.company_stage !== 'startup');

  return {
    total_rounds: baseRounds.length,
    timeline_days: isBigTech ? '3-6 weeks' : '2-4 weeks',
    rounds: baseRounds,
    oa: {
      likely: oaLikely,
      platform: oaLikely ? 'HackerRank / CodeSignal / Karat' : 'N/A',
      duration: '70-90 min',
      problem_count: 2,
      difficulty: 'Medium to Hard',
      topics: isSWE ? jdAnalysis.interview_focus?.technical || [] : [],
    },
  };
}

// ── Pass 3：分类题库生成（拆成 4 个独立调用，可靠性更高）─

export async function generateInterviewQuestions(jdAnalysis, structure, job, apiKey, lang = 'zh', resume = '') {
  const [hr, behavioral, technical, reverse] = await Promise.all([
    _generateHR(jdAnalysis, job, apiKey, lang),
    _generateBehavioral(jdAnalysis, job, apiKey, lang, resume),
    _generateTechnical(jdAnalysis, job, apiKey, lang),
    _generateReverse(jdAnalysis, job, apiKey, lang),
  ]);
  return { hr_round: { ...hr, reverse_questions: reverse }, behavioral, technical };
}

async function _generateHR(jdAnalysis, job, apiKey, lang) {
  const isZh = lang === 'zh';
  const prompt = `You are an interview coach. Generate HR interview questions for this role.
Company: ${job.company}, Title: ${job.title}, Level: ${jdAnalysis.seniority}, Type: ${jdAnalysis.role_category}
${isZh ? 'Output in Simplified Chinese.' : 'Output in English.'}

Return ONLY a valid JSON object, no explanation:
{
  "self_intro": {
    "framework": "${isZh ? '过去经历 → 核心优势 → 为什么这个职位' : 'Past experience → Core strengths → Why this role'}",
    "tips": ["tip1", "tip2", "tip3"]
  },
  "motivation": [
    {"q": "question text", "tip": "answering tip"}
  ],
  "logistics": [
    {"q": "question text", "tip": "answering tip"}
  ]
}

Generate 1 self_intro framework, 4 motivation questions, 3 logistics questions. Make them specific to ${job.company} and the ${jdAnalysis.role_category} industry.`;

  const text = await callClaude(apiKey, prompt, 1500);
  return parseJSON(text, { self_intro: { framework: '', tips: [] }, motivation: [], logistics: [] });
}

async function _generateBehavioral(jdAnalysis, job, apiKey, lang, resume = '') {
  const isZh = lang === 'zh';
  const competencies = jdAnalysis.interview_focus?.behavioral?.join(', ') || 'teamwork, problem-solving, leadership';
  const resumeSection = resume ? `\nCandidate resume context:\n${resume.slice(0, 1500)}` : '';

  const prompt = `You are an interview coach. Generate behavioral interview questions for this role.
Company: ${job.company}, Title: ${job.title}, Level: ${jdAnalysis.seniority}
Key competencies to test: ${competencies}
Key responsibilities: ${(jdAnalysis.key_responsibilities || []).slice(0, 4).join(' | ')}
${resumeSection}
${isZh ? 'Output in Simplified Chinese.' : 'Output in English.'}

Return ONLY a valid JSON array, no explanation:
[
  {
    "competency": "competency name",
    "q": "Tell me about a time when...",
    "star_hints": {
      "S": "what situation to describe",
      "T": "what task/challenge",
      "A": "key actions to highlight",
      "R": "measurable result to mention"
    }${resume ? ',\n    "resume_hook": "which part of candidate experience to draw from"' : ''}
  }
]

Generate exactly 6 behavioral questions, each testing a different competency. Vary the difficulty and specificity.`;

  const text = await callClaude(apiKey, prompt, 2000);
  return parseJSON(text, []);
}

async function _generateTechnical(jdAnalysis, job, apiKey, lang) {
  const isZh = lang === 'zh';
  const skills   = (jdAnalysis.required_skills || []).join(', ') || 'general skills';
  const topics   = (jdAnalysis.interview_focus?.technical || []).join(', ') || 'core concepts';
  const domain   = (jdAnalysis.interview_focus?.domain || []).join(', ');

  const prompt = `You are an interview coach. Generate technical interview questions for this role.
Company: ${job.company}, Title: ${job.title}
Role type: ${jdAnalysis.role_category}, Level: ${jdAnalysis.seniority}
Required skills: ${skills}
Technical topics: ${topics}
${domain ? `Domain knowledge: ${domain}` : ''}
JD excerpt: ${(job.description || '').slice(0, 800)}
${isZh ? 'Output questions in Simplified Chinese, but keep technical terms in English.' : 'Output in English.'}

Return ONLY a valid JSON array, no explanation:
[
  {
    "category": "category name (e.g. Financial Modeling, SQL, System Design, Algorithms)",
    "difficulty": "Easy or Medium or Hard",
    "q": "question text",
    "key_points": ["key point 1", "key point 2"]
  }
]

Generate exactly 8 questions across at least 3 different categories. Mix difficulty: 2 Easy, 4 Medium, 2 Hard.`;

  const text = await callClaude(apiKey, prompt, 2000);
  return parseJSON(text, []);
}

async function _generateReverse(jdAnalysis, job, apiKey, lang) {
  const isZh = lang === 'zh';
  const prompt = `You are an interview coach. Generate smart questions for a candidate to ask interviewers.
Company: ${job.company}, Title: ${job.title}, Type: ${jdAnalysis.role_category}
Culture signals: ${(jdAnalysis.culture_signals || []).join(', ')}
${isZh ? 'Output in Simplified Chinese.' : 'Output in English.'}

Return ONLY a valid JSON object, no explanation:
{
  "for_hr": ["question 1", "question 2", "question 3"],
  "for_hiring_manager": ["question 1", "question 2", "question 3"],
  "for_team": ["question 1", "question 2", "question 3"]
}

Generate exactly 3 questions for each audience. Make them insightful and specific to ${job.company}.`;

  const text = await callClaude(apiKey, prompt, 800);
  return parseJSON(text, { for_hr: [], for_hiring_manager: [], for_team: [] });
}

// ── OA LeetCode prep ─────────────────────────────────

export async function generateOAPrep(jdAnalysis, job, apiKey, lang = 'en') {
  const isZh     = lang === 'zh';
  const skills   = (jdAnalysis.required_skills || []).join(', ') || 'general algorithms';
  const topics   = (jdAnalysis.interview_focus?.technical || []).join(', ') || 'data structures';
  const level    = jdAnalysis.seniority || 'Mid';

  const prompt = `You are an expert competitive programmer and interview coach.
Generate a comprehensive OA (Online Assessment) preparation guide.
${isZh ? 'Output all text fields in Simplified Chinese, but keep LeetCode problem names and code terms in English.' : 'Output in English.'}

Company: ${job.company}
Role: ${job.title}, Level: ${level}
Required skills: ${skills}
Technical focus areas: ${topics}

Return ONLY valid JSON, no explanation:
{
  "company_patterns": "2-3 sentence description of what ${job.company} typically tests in OA, based on the role and industry",
  "topic_weights": [
    {"topic": "Arrays & Hashing", "weight": "High", "reason": "why this topic matters for this role"}
  ],
  "leetcode_recommendations": [
    {
      "id": 1,
      "name": "Two Sum",
      "difficulty": "Easy",
      "url": "https://leetcode.com/problems/two-sum/",
      "reason": "why this problem is relevant",
      "pattern": "Hash Map"
    }
  ],
  "generated_problems": [
    {
      "title": "problem title",
      "difficulty": "Easy or Medium or Hard",
      "description": "clear problem statement",
      "example_input": "example",
      "example_output": "expected output",
      "constraints": "constraints like 1 <= n <= 10^5",
      "hint": "high-level approach hint without giving away the solution",
      "pattern": "algorithm pattern name"
    }
  ],
  "time_strategy": "how to manage time during the OA",
  "common_mistakes": ["mistake 1", "mistake 2", "mistake 3"]
}

Rules:
- topic_weights: list 5-6 topics ordered by importance for THIS specific role
- leetcode_recommendations: exactly 10 problems, mix of Easy/Medium/Hard matching the role level
- generated_problems: exactly 3 original problems inspired by ${job.company}'s OA style and the JD requirements
- Make the generated_problems realistic and solvable, not trivially easy or impossibly hard`;

  const text = await callClaude(apiKey, prompt, 3000);
  return parseJSON(text, {
    company_patterns: '',
    topic_weights: [],
    leetcode_recommendations: [],
    generated_problems: [],
    time_strategy: '',
    common_mistakes: [],
  });
}

// ── Resume analysis ───────────────────────────────────

export async function analyzeResumeVsJD(job, jdAnalysis, resume, apiKey, lang = 'zh') {
  const isZh = lang === 'zh';
  const prompt = `You are a career coach. Analyze this resume against the job requirements.
${isZh ? 'Output in Simplified Chinese.' : 'Output in English.'}

JOB: ${job.company} — ${job.title}
Required skills: ${(jdAnalysis.required_skills || []).join(', ')}
Key responsibilities: ${(jdAnalysis.key_responsibilities || []).slice(0, 4).join(' | ')}
Seniority: ${jdAnalysis.seniority}

RESUME:
${resume.slice(0, 2500)}

Return ONLY a valid JSON object:
{
  "match_score": 85,
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "gaps": ["gap 1", "gap 2"],
  "talking_points": [
    {"experience": "specific experience from resume", "maps_to": "JD requirement it addresses"}
  ],
  "advice": "1-2 sentence overall coaching advice"
}`;

  const text = await callClaude(apiKey, prompt, 1500);
  return parseJSON(text, { match_score: 0, strengths: [], gaps: [], talking_points: [], advice: '' });
}
