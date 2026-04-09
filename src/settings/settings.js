// Claude API Key
const keyInput = document.getElementById('api-key');
const saveBtn  = document.getElementById('save-btn');
const status   = document.getElementById('status');

chrome.storage.local.get(['apiKey'], r => {
  if (r.apiKey) keyInput.placeholder = '已保存（重新输入可覆盖）';
});

saveBtn.addEventListener('click', async () => {
  const key = keyInput.value.trim();
  if (!key) { showStatus(status, '请输入 API Key', false); return; }
  if (!key.startsWith('sk-ant-')) { showStatus(status, '格式不对，应以 sk-ant- 开头', false); return; }

  saveBtn.textContent = '验证中...'; saveBtn.disabled = true;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.ok || res.status === 200) {
      chrome.storage.local.set({ apiKey: key }, () => {
        showStatus(status, '✓ 保存成功，API Key 有效', true);
        keyInput.value = ''; keyInput.placeholder = '已保存（重新输入可覆盖）';
      });
    } else if (res.status === 401) {
      showStatus(status, 'Key 无效，请检查是否填写正确', false);
    } else {
      showStatus(status, `验证失败 (${res.status})，Key 已保存`, false);
      chrome.storage.local.set({ apiKey: key });
    }
  } catch (e) {
    showStatus(status, '网络错误，请检查网络后重试', false);
  }

  saveBtn.textContent = '保存'; saveBtn.disabled = false;
});

// Google OAuth Client ID
const googleInput   = document.getElementById('google-client-id');
const googleSaveBtn = document.getElementById('save-google-btn');
const googleStatus  = document.getElementById('google-status');
const redirectUriEl = document.getElementById('redirect-uri');

const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
redirectUriEl.textContent = redirectUri;
redirectUriEl.addEventListener('click', () => {
  navigator.clipboard.writeText(redirectUri).then(() => {
    redirectUriEl.textContent = '✓ 已复制！';
    setTimeout(() => { redirectUriEl.textContent = redirectUri; }, 1500);
  });
});

chrome.storage.local.get(['googleClientId'], r => {
  if (r.googleClientId) googleInput.placeholder = '已保存（重新输入可覆盖）';
});

googleSaveBtn.addEventListener('click', () => {
  const clientId = googleInput.value.trim();
  if (!clientId) { showStatus(googleStatus, '请输入 Client ID', false); return; }
  if (!clientId.includes('.apps.googleusercontent.com')) {
    showStatus(googleStatus, '格式不对，应以 .apps.googleusercontent.com 结尾', false); return;
  }
  chrome.storage.local.set({ googleClientId: clientId }, () => {
    showStatus(googleStatus, '✓ 已保存', true);
    googleInput.value = ''; googleInput.placeholder = '已保存（重新输入可覆盖）';
  });
});

// Resume
const resumeTextarea  = document.getElementById('resume-text');
const saveResumeBtn   = document.getElementById('save-resume-btn');
const resumeStatus    = document.getElementById('resume-status');
const resumeDrop      = document.getElementById('resume-drop');
const resumeFileInput = document.getElementById('resume-file');
const fileLoading     = document.getElementById('file-loading');

chrome.storage.local.get(['resume'], r => {
  if (r.resume) resumeTextarea.value = r.resume;
});

saveResumeBtn.addEventListener('click', () => {
  const text = resumeTextarea.value.trim();
  chrome.storage.local.set({ resume: text }, () => {
    showStatus(resumeStatus, text ? '✓ 简历已保存' : '✓ 简历已清除', true);
  });
});

// ── File upload ──────────────────────────────────────────

document.getElementById('browse-label').addEventListener('click', () => resumeFileInput.click());
resumeDrop.addEventListener('click', e => { if (e.target.id !== 'browse-label') resumeFileInput.click(); });

resumeDrop.addEventListener('dragover', e => { e.preventDefault(); resumeDrop.classList.add('drag-over'); });
resumeDrop.addEventListener('dragleave', () => resumeDrop.classList.remove('drag-over'));
resumeDrop.addEventListener('drop', e => {
  e.preventDefault();
  resumeDrop.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleResumeFile(file);
});

resumeFileInput.addEventListener('change', () => {
  if (resumeFileInput.files[0]) handleResumeFile(resumeFileInput.files[0]);
  resumeFileInput.value = '';
});

async function handleResumeFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  fileLoading.style.display = 'block';
  showStatus(resumeStatus, '', true);

  try {
    let text = '';
    if (ext === 'txt') {
      text = await readAsText(file);
    } else if (ext === 'pdf') {
      text = await extractPDF(file);
    } else if (ext === 'docx' || ext === 'doc') {
      text = await extractDOCX(file);
    } else {
      showStatus(resumeStatus, '不支持的文件格式，请使用 PDF、Word 或 TXT', false);
      return;
    }

    const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned) { showStatus(resumeStatus, '未能从文件中提取文字，请尝试粘贴文本', false); return; }
    resumeTextarea.value = cleaned;
    showStatus(resumeStatus, `✓ 已从 ${file.name} 提取文字，检查无误后点击保存`, true);
  } catch (err) {
    showStatus(resumeStatus, `解析失败：${err.message}`, false);
  } finally {
    fileLoading.style.display = 'none';
  }
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

async function extractPDF(file) {
  if (!window.pdfjsLib) throw new Error('PDF 库未加载，请运行 setup-libs.sh');
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/lib/pdf.worker.min.js');

  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text     = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

async function extractDOCX(file) {
  if (!window.mammoth) throw new Error('Word 库未加载，请运行 setup-libs.sh');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

function showStatus(el, msg, ok) {
  el.textContent = msg;
  el.className = 'status ' + (ok ? 'ok' : 'err');
}
