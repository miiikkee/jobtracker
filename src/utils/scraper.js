// Injected into job listing pages via chrome.scripting.executeScript
// Must be self-contained (no imports allowed in injected functions)

export function grabAnyPage() {
  function cap(t, n = 4000) { return (t || '').replace(/\s+/g, ' ').trim().slice(0, n); }

  function firstText(...sels) {
    for (const s of sels) {
      const t = document.querySelector(s)?.innerText?.trim();
      if (t) return t;
    }
    return '';
  }

  function isValidCompany(text) {
    if (!text || text.length < 2 || text.length > 80) return false;
    const noise = /new york|los angeles|san francisco|chicago|boston|remote|hybrid|on.?site|full.?time|part.?time|\$|\/yr|\/year|united states|california|texas|apply|job post/i;
    return !noise.test(text);
  }

  const host = location.hostname;

  if (host.includes('indeed.com')) {
    return {
      title:       firstText('[data-testid="jobsearch-JobInfoHeader-title"]', 'h1'),
      company:     document.querySelector('[data-testid="inlineHeader-companyName"]')?.innerText?.trim() || '',
      location:    firstText('[data-testid="job-location"]'),
      description: cap(document.querySelector('#jobDescriptionText')?.innerText || ''),
    };
  }

  if (host.includes('glassdoor.com')) {
    return {
      title:       firstText('[data-test="job-title"]', 'h1'),
      company:     '',
      location:    firstText('[data-test="location"]', '[class*="location" i]'),
      description: cap(document.querySelector('[class*="JobDetails_jobDescription" i], [class*="desc" i]')?.innerText || ''),
    };
  }

  if (host.includes('joinhandshake.com') || host.includes('handshake.com')) {
    return {
      title:       firstText('h1', '[class*="job-title" i]'),
      company:     '',
      location:    firstText('[class*="location" i]', '[class*="city" i]'),
      description: cap(document.querySelector('[class*="description" i], main')?.innerText || ''),
    };
  }

  if (host.includes('efinancialcareers')) {
    const h1 = document.querySelector('h1');
    const rawCompany = h1?.nextElementSibling?.innerText?.trim() || '';
    return {
      title:       h1?.innerText?.trim() || '',
      company:     isValidCompany(rawCompany) ? rawCompany : '',
      location:    firstText('[class*="location" i]', '[class*="city" i]'),
      description: cap(document.querySelector('[class*="description" i], main')?.innerText || ''),
    };
  }

  if (host.includes('workday') || host.includes('myworkdayjobs') || host.includes('oraclecloud')) {
    return {
      title:       firstText('[data-automation-id="jobPostingHeader"]', 'h1', 'h2'),
      company:     firstText('[data-automation-id="orgName"]'),
      location:    firstText('[data-automation-id="locations"]', '[class*="location" i]'),
      description: cap(document.querySelector('[data-automation-id="jobPostingDescription"], main')?.innerText || ''),
    };
  }

  if (host.includes('greenhouse.io')) {
    return {
      title:       firstText('h1.app-title', 'h1'),
      company:     firstText('.company-name'),
      location:    firstText('.location'),
      description: cap(document.querySelector('#content')?.innerText || ''),
    };
  }

  if (host.includes('lever.co')) {
    return {
      title:       firstText('.posting-headline h2', 'h2'),
      company:     document.querySelector('.main-header-logo img')?.alt?.trim() || '',
      location:    firstText('.sort-by-time', '.location'),
      description: cap(document.querySelector('.posting-description')?.innerText || ''),
    };
  }

  // Generic fallback
  const h1 = document.querySelector('h1');
  const title = h1?.innerText?.trim() || document.title.split(/[|\-–]/)[0].trim();
  const nextSib = h1?.nextElementSibling?.innerText?.trim() || '';
  const company = isValidCompany(nextSib) ? nextSib : '';

  const descEl =
    document.querySelector('main [class*="description" i]') ||
    document.querySelector('main [class*="content" i]') ||
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[class*="job-description" i]') ||
    document.querySelector('[class*="jobDescription" i]');

  const rawDesc = descEl?.innerText?.trim() || '';
  return {
    title,
    company,
    location: '',
    description: cap(rawDesc.length > 300 ? rawDesc : document.body.innerText),
  };
}
