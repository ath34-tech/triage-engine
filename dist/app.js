const themeButton = document.querySelector('#theme');
const themeKey = 'acadza-color-theme';
const preference = matchMedia('(prefers-color-scheme: dark)');

function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeButton.setAttribute('aria-pressed', String(dark));
  themeButton.textContent = dark ? 'Light mode' : 'Dark mode';
}

setTheme((localStorage.getItem(themeKey) ?? (preference.matches ? 'dark' : 'light')) === 'dark');
themeButton.onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  setTheme(dark);
  localStorage.setItem(themeKey, dark ? 'dark' : 'light');
};

const queue = document.querySelector('#queue');
const detail = document.querySelector('#detail');
const filter = document.querySelector('#filter');
const search = document.querySelector('#search');
const typeFilter = document.querySelector('#type-filter');
const subjectFilter = document.querySelector('#subject-filter');
const verdictFilter = document.querySelector('#verdict-filter');
const searchable = new Map();
const storageKey = 'acadza-review-v1';
const audit = JSON.parse(localStorage.getItem(storageKey) || '{}');
let selected;

function element(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

// Build fresh nodes from an allowlist. Never attach the parsed input or its attributes.
const htmlTags = new Set('p div span h2 h3 h4 br b strong i em sub sup ul ol li table tbody tr td th'.split(' '));
const mathTags = new Set('math mrow mi mn mo mtext mfrac msup msub msubsup msqrt mroot mstyle mspace mtable mtr mtd mover munder munderover mfenced'.split(' '));
const discarded = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'template']);
function renderHtml(target, html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  function copy(source, parent) {
    if (source.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(source.textContent));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE || discarded.has(source.localName)) return;
    const tag = source.localName;
    let childParent = parent;
    if (source.namespaceURI === 'http://www.w3.org/1998/Math/MathML' && mathTags.has(tag)) {
      childParent = document.createElementNS(source.namespaceURI, tag);
      for (const name of ['display', 'mathvariant', 'stretchy', 'displaystyle', 'width', 'height', 'depth', 'linebreak']) {
        if (source.hasAttribute(name)) childParent.setAttribute(name, source.getAttribute(name));
      }
      parent.append(childParent);
    } else if (htmlTags.has(tag)) {
      childParent = element(parent, tag);
    } else if (tag === 'img') {
      element(parent, 'span', '[Figure in source record]');
    }
    for (const child of source.childNodes) copy(child, childParent);
  }
  for (const node of template.content.childNodes) copy(node, target);
}

function label(value) { return value.replaceAll('_', ' '); }
function primary(item) { return item.reports.find(report => report.route === 'faculty_review') ?? item.reports[0]; }
const risk = new Set(['answer_key', 'type_mismatch', 'unsound', 'stem_data', 'option_repair', 'diagram']);
function priority(item) {
  const report = primary(item);
  return (report.route === 'faculty_review' ? 100 : 0) + (risk.has(report.repair) ? 20 : 0) + item.reports.length;
}
function latest(item) { return audit[item.id]?.at(-1); }

function render() {
  queue.replaceChildren();
  const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = cases.filter(item => {
    const status = latest(item) ? 'done' : primary(item).route === 'faculty_review' ? 'pending' : 'closed';
    return (filter.value === 'all' || filter.value === status) &&
      (!typeFilter.value || item.type === typeFilter.value) &&
      (!subjectFilter.value || item.subject === subjectFilter.value) &&
      (!verdictFilter.value || item.reports.some(report => report.verdict === verdictFilter.value)) &&
      terms.every(term => searchable.get(item.id).includes(term));
  });
  document.querySelector('#count').textContent = `${visible.length} of ${cases.length} questions`;
  if (!visible.some(item => item.id === selected)) selected = visible[0]?.id;
  for (const item of visible) {
    const report = primary(item);
    const button = element(queue, 'button', undefined, 'item');
    button.setAttribute('aria-current', String(item.id === selected));
    element(button, 'strong', label(report.repair ?? report.verdict));
    element(button, 'small', `${report.reportId} · ${item.reports.length} report(s)${latest(item) ? ' · ' + latest(item).action : ''}`);
    button.onclick = () => { selected = item.id; render(); };
  }
  show(visible.find(item => item.id === selected));
}

function show(item) {
  detail.replaceChildren();
  if (!item) {
    element(detail, 'h2', 'No matching questions');
    element(detail, 'p', 'Try a different search or adjust the queue filters.');
    return;
  }
  const report = primary(item);
  const decision = latest(item);
  element(detail, 'div', decision?.action ?? label(report.route), 'chip');
  element(detail, 'h2', label(report.repair ?? report.verdict));
  element(detail, 'small', `${item.subject} · ${item.chapter} · ${item.type.toUpperCase()}`);
  const evidence = element(detail, 'section', undefined, 'evidence');
  element(evidence, 'h3', 'Evidence');
  element(evidence, 'p', report.evidence);
  const content = element(detail, 'section', undefined, 'content');
  element(content, 'h3', 'Stored question');
  renderHtml(element(content, 'div', undefined, 'mathbody'), item.content.question);
  element(content, 'small', 'Stored answer · ' + JSON.stringify(item.content.answer));
  const solution = element(content, 'details');
  element(solution, 'summary', 'Stored solution');
  renderHtml(element(solution, 'div', undefined, 'mathbody'), item.content.solution);

  const change = element(detail, 'section');
  element(change, 'h3', 'Proposed change');
  const edit = report.edit;
  if (edit) {
    element(change, 'small', 'Field · ' + edit.field);
    const diff = element(change, 'div', undefined, 'diff');
    for (const [title, value] of [['Before', edit.find], ['After', decision?.edit?.replace ?? edit.replace]]) {
      const column = element(diff, 'div');
      element(column, 'strong', title);
      const fragment = element(column, 'p');
      if (value === '') fragment.textContent = '(removed)';
      else if (edit.field === 'answer') fragment.textContent = JSON.stringify(value);
      else renderHtml(fragment, value);
    }
  } else {
    element(change, 'p', 'This case has no proposed patch.');
  }
  for (const entry of item.reports) {
    const message = element(detail, 'details');
    message.open = entry === report;
    element(message, 'summary', entry.reportId + ' · Student report and reply');
    element(message, 'p', entry.comment || '(empty report)');
    element(message, 'blockquote', entry.student_reply);
  }
  if (report.route === 'faculty_review' && !decision) {
    const status = element(detail, 'p');
    status.setAttribute('role', 'status');
    const actions = element(detail, 'div', undefined, 'actions');
    function record(action, approvedEdit = null) {
      const entries = [...(audit[item.id] ?? []), {action, edit: approvedEdit, at: new Date().toISOString()}];
      try {
        localStorage.setItem(storageKey, JSON.stringify({...audit, [item.id]: entries}));
        audit[item.id] = entries;
        filter.value = 'all';
        render();
      } catch {
        status.textContent = 'The browser could not save this decision. Try again.';
      }
    }
    if (edit) {
      element(actions, 'button', 'Approve patch', 'primary').onclick = () => record('Approved', edit);
      element(actions, 'button', 'Edit patch').onclick = () => {
        if (change.querySelector('textarea')) return;
        const editor = element(change, 'textarea');
        editor.setAttribute('aria-label', 'Replacement value');
        editor.value = edit.field === 'answer' ? JSON.stringify(edit.replace) : edit.replace;
        editor.focus();
        element(change, 'button', 'Save edited patch').onclick = () => {
          try {
            const replacement = edit.field === 'answer' ? JSON.parse(editor.value) : editor.value;
            if (Array.isArray(edit.find) ? !Array.isArray(replacement) : typeof replacement !== typeof edit.find) {
              throw new Error('Wrong answer shape');
            }
            record('Edited and approved', {...edit, replace: replacement});
          } catch {
            status.textContent = 'Use the same answer format as the original value.';
          }
        };
      };
    } else {
      element(actions, 'button', 'Confirm issue', 'primary').onclick = () => record('Confirmed · no patch');
    }
    element(actions, 'button', 'Reject').onclick = () => record('Rejected');
  }
  if (decision) {
    const history = element(detail, 'section');
    element(history, 'h3', 'Audit history');
    for (const entry of audit[item.id]) {
      element(history, 'p', `${entry.action} · ${new Date(entry.at).toLocaleString()}`);
    }
    element(history, 'small', 'Decisions are saved in this browser.');
  }
}

let cases;
try {
  const response = await fetch('cases.json');
  if (!response.ok) throw new Error('Case data unavailable');
  cases = (await response.json()).sort((a, b) => priority(b) - priority(a));
  const source = document.createElement('template');
  for (const item of cases) {
    source.innerHTML = item.content.question || '';
    const questionText = source.content.textContent.replace(/\s+/g, ' ');
    searchable.set(item.id, [item.id, item.qid, item.subject, item.chapter, item.type,
      questionText, ...item.reports.flatMap(report => [report.reportId, report.comment])]
      .join(' ').toLowerCase());
  }
  for (const subject of [...new Set(cases.map(item => item.subject).filter(Boolean))].sort()) {
    subjectFilter.add(new Option(subject, subject));
  }
  const verdicts = new Set(cases.flatMap(item => item.reports.map(report => report.verdict)));
  for (const verdict of [...verdicts].sort()) {
    const title = label(verdict);
    verdictFilter.add(new Option(title[0].toUpperCase() + title.slice(1), verdict));
  }
  for (const control of [filter, typeFilter, subjectFilter, verdictFilter]) {
    control.onchange = render;
  }
  search.oninput = render;
  render();
} catch {
  detail.textContent = 'Could not load the review snapshot. Serve the dist folder over HTTP.';
}
