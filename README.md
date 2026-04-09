# JobTracker — AI-Powered Job Application Tracker

A Chrome extension that tracks your job applications, auto-reads Gmail to update statuses, and uses AI to prepare you for every interview.

**All data stays in your browser. No server. No sign-up.**

---

## Features

### Application Tracking
- One-click save from LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Workday, eFinancialCareers
- Status pipeline: Saved → Applied → Interviewing → Offer / Rejected
- AI-generated job summaries on each card

### Gmail Integration
- Connect your Gmail to auto-scan application confirmation emails
- Auto-updates statuses (applied, interview scheduled, rejection)
- Detects new applications and adds them to your list
- Incremental scanning — only reads new emails since last sync

### AI Interview Prep (per job)
**Pass 1 — JD Analysis**
- Role category, seniority, required vs. nice-to-have skills
- Culture signals, interview focus areas

**Pass 2 — Interview Structure Prediction**
- Predicted round count, format, timeline, and focus per round
- OA likelihood detection

**Pass 3 — Question Bank (5 parallel AI calls)**
- HR Round: self-intro framework, motivation & logistics questions
- Behavioral: 6 STAR-framework questions mapped to JD competencies
- Technical: 8 questions across 3+ categories, mixed difficulty
- Questions to Ask: tailored for recruiter, hiring manager, and team

**Pass 4 — Resume Match Analysis** *(if resume uploaded)*
- Match score, strengths, gaps
- Per-question STAR hints drawn from your own experience

### OA / LeetCode Prep
- Topic priority weights ranked for this specific role
- 10 curated LeetCode problem recommendations with pattern tags
- 3 AI-generated original practice problems (expandable with hints)
- Time strategy and common mistakes

### Resume Upload
- Supports **PDF**, **Word (.docx)**, and plain text paste
- Extracted text is editable before saving

### Multi-language
- Auto-detects Chinese/English from JD
- All AI output matches the JD language

---

## Installation

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/jobtracker.git
cd jobtracker
```

### 2. Download optional libraries (for PDF/Word resume parsing)
```bash
bash setup-libs.sh
```

### 3. Load in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `jobtracker` folder
4. Pin the extension to your toolbar

---

## Setup

### Claude API Key (required for AI features)
1. Go to [console.anthropic.com](https://console.anthropic.com) and create an API key
2. Open extension → Settings → paste your key and click Save
3. Cost: Claude Haiku is very cheap (~$0.25/MTok). Typical usage is a few cents per interview prep run.

### Gmail Integration (optional)
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project → enable **Gmail API**
3. Create OAuth 2.0 credentials (type: **Web Application**)
4. Add the redirect URI shown in extension Settings (click the code block to copy)
5. Copy the **Client ID** → paste into extension Settings → Save
6. Click "Sync Gmail" in the popup to authorize and start scanning

---

## Usage

### Saving a job
Navigate to any supported job listing page and click the JobTracker popup → **Save Job**. The extension scrapes the JD automatically.

### Updating status
Click any job card in the popup → select the new status from the dropdown.

### Interview Prep
Open any saved job → click **Interview Prep**. The analysis runs automatically (30–60 seconds). Results are cached — reopen instantly next time.

To regenerate with fresh AI output, click **↺ Regenerate** in the prep page header.

### Resume upload
Settings → Resume section → drag & drop or click to upload PDF/Word, or paste text directly.

---

## Privacy

- All job data is stored in `chrome.storage.local` on your device
- Gmail token is stored locally and never sent to any third-party server
- AI calls go directly from your browser to Anthropic's API using your own key
- Resume text is stored locally only
- Removing the extension deletes all data

---

## Tech Stack

| Layer | Choice |
|---|---|
| Extension | Chrome MV3, ES Modules (no build step) |
| AI | Claude Haiku (`claude-haiku-4-5-20251001`) |
| Gmail | Gmail REST API v1 + OAuth via `chrome.identity` |
| PDF parsing | pdf.js 3.x |
| Word parsing | mammoth.js |
| Storage | `chrome.storage.local` |

---

## Supported Job Sites

| Site | Auto-scrape |
|---|---|
| LinkedIn Jobs | ✓ |
| Indeed | ✓ |
| Glassdoor | ✓ |
| Greenhouse | ✓ |
| Lever | ✓ |
| Workday / myWorkdayJobs | ✓ |
| eFinancialCareers | ✓ |
| Other sites | Generic fallback |

---

## Roadmap

- [ ] Export to CSV / Notion
- [ ] Follow-up reminder notifications
- [ ] Notes field per application
- [ ] Chrome Web Store release
- [ ] Firefox support

---

## Contributing

PRs welcome. For large changes, open an issue first to discuss the approach.

```
src/
  popup/          # Main popup UI
  settings/       # Settings page (API keys, resume)
  interview-prep/ # Interview prep full-page view
  utils/
    ai.js         # All Claude API calls
    gmail.js      # Gmail OAuth + email parsing
    storage.js    # chrome.storage wrappers
    scraper.js    # Job page scraper (injected)
    i18n.js       # UI strings (zh/en)
  lib/            # Optional vendor libs (see setup-libs.sh)
```

---

## License

MIT — see [LICENSE](LICENSE)
