// chrome.storage helpers

const store = {
  get: (keys) => new Promise(r => chrome.storage.local.get(keys, r)),
  set: (obj)  => new Promise(r => chrome.storage.local.set(obj, r)),
  remove: (keys) => new Promise(r => chrome.storage.local.remove(keys, r)),
};

export async function getJobs()      { return (await store.get(['jobs'])).jobs || []; }
export async function saveJobs(jobs) { return store.set({ jobs }); }
export async function getApiKey()    { return (await store.get(['apiKey'])).apiKey || ''; }
export async function getLang()      { return (await store.get(['lang'])).lang || 'zh'; }
export async function setLang(lang)  { return store.set({ lang }); }
export async function getGoogleClientId() {
  return (await store.get(['googleClientId'])).googleClientId || '';
}

export async function getResume()          { return (await store.get(['resume'])).resume || ''; }
export async function saveResume(text)     { return store.set({ resume: text }); }

export { store };
