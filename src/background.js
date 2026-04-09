chrome.runtime.onInstalled.addListener(() => {
  console.log('JobTracker installed');
});

// ── Follow-up reminder alarms ─────────────────────────
// Alarms are created in popup.js when a job moves to 'applied'.
// The background wakes up to fire notifications.

chrome.alarms.onAlarm.addListener(async alarm => {
  if (!alarm.name.startsWith('followup-')) return;

  const jobId = alarm.name.replace('followup-', '');
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const job = jobs.find(j => j.id === jobId);

  // Only notify if still in 'applied' (no response yet)
  if (!job || job.status !== 'applied') return;

  const company = job.summary?.company_confirmed || job.company || 'a company';
  const title   = job.summary?.title_confirmed   || job.title   || 'a role';

  chrome.notifications.create(`followup-notify-${jobId}`, {
    type:    'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title:   'Follow-up Reminder · JobTracker',
    message: `It's been 7 days since you applied to ${title} at ${company}. Consider sending a follow-up email.`,
    buttons: [{ title: 'Open JobTracker' }],
    priority: 1,
  });
});

chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (notifId.startsWith('followup-notify-') && btnIdx === 0) {
    chrome.action.openPopup().catch(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') });
    });
  }
});
