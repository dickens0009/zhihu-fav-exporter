function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 每篇导出之间的固定间隔（不再从 popup 传入/用户配置）
const FIXED_DELAY_MS = 1000;

// ===== Progress Notifications (MV3) =====
const NOTIF_ID = "zhihu_export_progress";

function notifIconUrl() {
  // 没有 icon 也能跑；若你不想放图标，就 return undefined
  // 建议你在扩展目录放一个 icon128.png，然后保留这一行
  return "icon128.png";
}

function notifyCreateOrUpdate({ title, message }) {
  const opt = {
    type: "basic",
    iconUrl: notifIconUrl(),
    title: title || "知乎导出",
    message: message || "",
    priority: 2
  };

  // 用固定 ID 更新同一条通知，不会叠很多条
  chrome.notifications.create(NOTIF_ID, opt, () => {
    const err = chrome.runtime.lastError;
    if (err) console.error("notifications.create failed:", err.message);
  });
}

function notifyStart(scopeTitle, total) {
  notifyCreateOrUpdate({
    title: "知乎收藏导出开始",
    message: `${scopeTitle}\n总计待处理：${total} 篇`
  });
}

function notifyProgress(scopeTitle, done, total, ok, failed) {
  const pct = total ? Math.floor((done / total) * 100) : 0;
  notifyCreateOrUpdate({
    title: `知乎收藏导出进度：${pct}%`,
    message: `${scopeTitle}\n已处理：${done}/${total}\n成功：${ok}  失败：${failed}`
  });
}

function notifyDone(scopeTitle, done, total, ok, failed) {
  const pct = total ? Math.floor((done / total) * 100) : 100;
  notifyCreateOrUpdate({
    title: `知乎收藏导出完成：${pct}%`,
    message: `${scopeTitle}\n处理：${done}/${total}\n成功：${ok}  失败：${failed}`
  });

  // 可选：完成后 5 秒清掉通知，保持干净
  setTimeout(() => chrome.notifications.clear(NOTIF_ID), 5000);
}

// 自定义标题/文案的“完成”通知（复用同一条通知，不叠加）
function notifyDoneText({ title, message, clearAfterMs = 5000 }) {
  notifyCreateOrUpdate({
    title: title || "知乎收藏导出完成",
    message: message || "Markdown 文件已下载完成"
  });
  if (clearAfterMs > 0) {
    setTimeout(() => chrome.notifications.clear(NOTIF_ID), clearAfterMs);
  }
}

// 仅当用户“仍停留在发起导出的标签页”时才显示/更新通知；切走则清掉并停止更新。
async function createActiveTabNotifyGuard(originTabId) {
  // 未传 originTabId 时保持旧行为：始终允许通知
  if (!originTabId) {
    return { isEnabled: () => true, dispose: () => {} };
  }

  let enabled = true;

  const setEnabled = (v) => {
    enabled = !!v;
    if (!enabled) {
      try {
        chrome.notifications.clear(NOTIF_ID);
      } catch (_) {}
    }
  };

  const refreshActiveInWindow = async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return setEnabled(false);
    const [t] = await chrome.tabs.query({ active: true, windowId });
    setEnabled(t?.id === originTabId);
  };

  const onActivated = (activeInfo) => setEnabled(activeInfo.tabId === originTabId);
  const onRemoved = (tabId) => {
    if (tabId === originTabId) setEnabled(false);
  };
  const onFocusChanged = (windowId) => {
    refreshActiveInWindow(windowId).catch(() => {});
  };

  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.windows.onFocusChanged.addListener(onFocusChanged);

  // init：以当前焦点窗口的激活 tab 为准（避免上来就“误通知”）
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    setEnabled(t?.id === originTabId);
  } catch (_) {
    setEnabled(false);
  }

  return {
    isEnabled: () => enabled,
    dispose: () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    }
  };
}

// 给 popup 实时推送进度（popup 打开时可见；popup 关闭时不会报错）
function pushUiProgress(payload) {
  try {
    chrome.runtime.sendMessage({ type: "UI_PROGRESS", payload }, () => {
      // 忽略 popup 未打开/无接收方时的错误
      void chrome.runtime.lastError;
    });
  } catch (_) {
    // service worker 环境下，忽略
  }
}

// 节流：避免过于频繁更新通知
function makeProgressThrottler({ everyN = 10, minIntervalMs = 3000 }) {
  let lastTs = 0;
  return (done) => {
    const now = Date.now();
    if (done % everyN === 0 && now - lastTs >= minIntervalMs) {
      lastTs = now;
      return true;
    }
    if (now - lastTs >= minIntervalMs * 2) {
      lastTs = now;
      return true;
    }
    return false;
  };
}


function safeFilename(name, { maxLen = 120 } = {}) {
  let s = String(name || "");
  // 去掉控制字符/格式控制字符（很多是“不可见”的，但会让 Windows/Chrome 判定文件名非法）
  // 包含：C0/C1 控制字符、零宽字符、Bidi 控制符、BOM 等
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");

  // Windows 不允许的字符
  s = s.replace(/[\\/:*?"<>|]/g, "_");

  // 压缩空白
  s = s.replace(/\s+/g, " ").trim();
  if (!s) s = "untitled";

  // 截断：用 code point 截断，避免把 surrogate pair 从中间切开（会导致“非法字符串/文件名”）
  s = Array.from(s).slice(0, maxLen).join("").trim();

  // Windows 不允许以点号/空格结尾
  s = s.replace(/[. ]+$/g, "");
  if (!s) s = "untitled";

  // Windows 保留设备名（不区分大小写）
  const upper = s.toUpperCase();
  const reserved = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9"
  ]);
  if (reserved.has(upper)) s = `${s}_`;

  return s;
}

function safePath(pathLike) {
  // chrome.downloads.download 的 filename 用 / 作为分隔符
  return String(pathLike || "")
    .split("/")
    .filter(Boolean)
    .map((seg) => safeFilename(seg))
    .join("/");
}

async function zhihuApiGet(url) {
  const resp = await fetch(url, {
    credentials: "include",
    headers: {
      // 少数情况下知乎会对“非浏览器习惯”的请求更敏感；这里补齐常见 accept
      accept: "application/json, text/plain, */*"
    }
  });
  if (!resp.ok) {
    let body = "";
    try {
      body = await resp.text();
    } catch (_) {}
    const snippet = body ? body.slice(0, 300) : "";
    const err = new Error(`API ${resp.status}: ${url}${snippet ? ` | ${snippet}` : ""}`);
    err.status = resp.status;
    err.url = url;
    err.body = body;
    throw err;
  }
  return await resp.json();
}

function extractScriptJsonById(html, id) {
  const h = String(html || "");
  const re = new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const m = h.match(re);
  if (!m) return null;
  const txt = String(m[1] || "").trim();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

async function zhihuPageGetHtml(url) {
  const resp = await fetch(url, {
    credentials: "include",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!resp.ok) {
    let body = "";
    try {
      body = await resp.text();
    } catch (_) {}
    const snippet = body ? body.slice(0, 300) : "";
    const err = new Error(`page ${resp.status}: ${url}${snippet ? ` | ${snippet}` : ""}`);
    err.status = resp.status;
    err.url = url;
    err.body = body;
    throw err;
  }
  return await resp.text();
}

function pickZhihuInitialStateFromHtml(html) {
  // 知乎传统：<script id="js-initialData" type="application/json">...</script>
  const init = extractScriptJsonById(html, "js-initialData");
  if (init?.initialState) return init.initialState;
  if (init?.state) return init.state;
  if (init) return init;

  // 兼容：Next.js 页面可能是 <script id="__NEXT_DATA__" type="application/json">...</script>
  const next = extractScriptJsonById(html, "__NEXT_DATA__");
  const pp = next?.props?.pageProps;
  if (pp?.initialState) return pp.initialState;
  if (pp?.state) return pp.state;
  return null;
}

function pickZhihuAnswerEntity(initialState, answerId) {
  const id = String(answerId || "");
  const entities = initialState?.entities || initialState?.initialState?.entities;
  const answers = entities?.answers;
  if (answers && Object.prototype.hasOwnProperty.call(answers, id)) return answers[id];
  return null;
}

function pickZhihuQuestionEntity(initialState, qid) {
  const id = String(qid || "");
  const entities = initialState?.entities || initialState?.initialState?.entities;
  const questions = entities?.questions;
  if (questions && Object.prototype.hasOwnProperty.call(questions, id)) return questions[id];
  return null;
}

async function zhihuAnswerToMarkdownViaPage(answerId) {
  // 不需要 questionId：/answer/{id} 通常会 302 到 canonical URL
  const pageUrl = `https://www.zhihu.com/answer/${answerId}`;
  const htmlPage = await zhihuPageGetHtml(pageUrl);
  const initialState = pickZhihuInitialStateFromHtml(htmlPage);
  if (!initialState) {
    throw new Error(`无法从回答页面解析 initialState（可能是知乎结构变更或被风控）：${pageUrl}`);
  }

  const ans = pickZhihuAnswerEntity(initialState, answerId);
  if (!ans) {
    throw new Error(`回答页面中找不到 answers[${answerId}]（可能无权限/已删除）：${pageUrl}`);
  }

  const qid = ans?.question?.id || ans?.questionId || ans?.question_id;
  const q = qid ? pickZhihuQuestionEntity(initialState, qid) : null;

  const title = String(q?.title || "").trim() || "Untitled";
  const author = String(ans?.author?.name || ans?.author?.nickname || "").trim();
  const html = String(ans?.content || "");
  const url = qid
    ? `https://www.zhihu.com/question/${qid}/answer/${answerId}`
    : pageUrl;

  const bodyMd = html ? await convertHtmlToMarkdownOffscreen(html, url) : "";

  const updated = formatLocalDateTime(ans?.updatedTime || ans?.updated_time);
  const created = formatLocalDateTime(ans?.createdTime || ans?.created_time);
  const contentTimeText = updated ? `编辑于 ${updated}` : created ? `发布于 ${created}` : "";

  const fileBaseName = `${title}${author ? " - " + author : ""}`;
  const md =
    buildFrontMatter({ title, author, url }) +
    "\n" +
    (bodyMd ? bodyMd + "\n" : "") +
    (contentTimeText ? "\n" + contentTimeText + "\n" : "");

  return { ok: true, md, title, url, fileBaseName, contentTimeText };
}

async function getCollectionTotal(collectionId) {
  // 只取 1 条即可（通常 paging 里会带 totals/total）
  const api = `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=0&limit=1`;
  const data = await zhihuApiGet(api);
  const paging = data?.paging || {};
  const total =
    Number(paging?.totals) ||
    Number(paging?.total) ||
    Number(data?.totals) ||
    Number(data?.total) ||
    0;
  return total;
}

async function listMemberCollections(urlToken, limit = 200) {
  const out = [];
  let offset = 0;
  const pageSize = 20;
  let nextUrl = null;
  let emptyStreak = 0;

  while (out.length < limit) {
    const api =
      nextUrl ||
      `https://www.zhihu.com/api/v4/members/${encodeURIComponent(
        urlToken
      )}/collections?offset=${offset}&limit=${pageSize}`;

    const data = await zhihuApiGet(api);
    const arr = data?.data || [];
    out.push(...arr);

    const paging = data?.paging;
    const isEnd = typeof paging?.is_end === "boolean" ? paging.is_end : null;
    const next = typeof paging?.next === "string" ? paging.next : null;

    // 有些情况下接口会短暂返回空 data，但 paging 仍提示未结束（或缺失），这里做有限次重试
    if (arr.length === 0) {
      emptyStreak++;
    } else {
      emptyStreak = 0;
    }

    if (emptyStreak >= 3) break;

    // 优先用 paging 判断是否结束与 next URL
    if (isEnd === true) break;
    if (next) {
      nextUrl = next;
    } else {
      // 兜底：paging 缺失时退回 offset 翻页
      offset += pageSize;
      nextUrl = null;
    }

    await sleep(250);
  }
  return out.slice(0, limit);
}

async function listCollectionItems(collectionId, limit = 200) {
  const out = [];
  let offset = 0;
  const pageSize = 20;
  let nextUrl = null;
  let emptyStreak = 0;

  while (out.length < limit) {
    const api =
      nextUrl ||
      `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=${offset}&limit=${pageSize}`;

    const data = await zhihuApiGet(api);
    const arr = data?.data || [];
    out.push(...arr);

    const paging = data?.paging;
    const isEnd = typeof paging?.is_end === "boolean" ? paging.is_end : null;
    const next = typeof paging?.next === "string" ? paging.next : null;

    if (arr.length === 0) {
      emptyStreak++;
    } else {
      emptyStreak = 0;
    }

    if (emptyStreak >= 3) break;

    if (isEnd === true) break;
    if (next) {
      nextUrl = next;
    } else {
      offset += pageSize;
      nextUrl = null;
    }

    await sleep(250);
  }
  return out.slice(0, limit);
}

function itemToUrl(item) {
  const c = item?.content;
  if (!c) return null;

  if (c.type === "answer") {
    const aid = c.id;
    const qid = c.question?.id;
    if (qid && aid) return `https://www.zhihu.com/question/${qid}/answer/${aid}`;
    return item?.url || null;
  }

  // 你目前重点是“回答”，其他类型先兜底保留
  if (c.type === "article" && c.id) return `https://zhuanlan.zhihu.com/p/${c.id}`;
  if (c.type === "pin" && c.id) return `https://www.zhihu.com/pin/${c.id}`;
  if (c.type === "zvideo" && c.id) return `https://www.zhihu.com/zvideo/${c.id}`;

  return item?.url || null;
}

function toDataUrlMarkdown(content) {
  return "data:text/markdown;charset=utf-8," + encodeURIComponent(content);
}

async function downloadMarkdownFile(filename, content) {
  const url = toDataUrlMarkdown(content);
  const safeName = safePath(filename);
  const downloadId = await chrome.downloads.download({
    url,
    filename: safeName,
    saveAs: false
  });
  return downloadId;
}

// ===== Offscreen HTML -> Markdown =====
async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("chrome.offscreen is not available (need Chrome MV3 offscreen support)");
  }
  try {
    const has = typeof chrome.offscreen.hasDocument === "function"
      ? await chrome.offscreen.hasDocument()
      : false;
    if (has) return;
  } catch (_) {
    // 忽略：继续尝试 createDocument
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: "Convert Zhihu HTML content to Markdown without opening tabs."
  });
}

async function convertHtmlToMarkdownOffscreen(html, baseUrl) {
  await ensureOffscreenDocument();
  const resp = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_CONVERT_HTML_TO_MD",
    html,
    baseUrl
  });
  if (!resp?.ok) throw new Error(resp?.error || "offscreen convert failed");
  return resp.md || "";
}

async function extractTextFromHtmlOffscreen(html, selector) {
  await ensureOffscreenDocument();
  const resp = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_EXTRACT_TEXT",
    html,
    selector
  });
  if (!resp?.ok) throw new Error(resp?.error || "offscreen extract failed");
  return resp.text || "";
}

function formatLocalDateTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "";
  // 兼容秒/毫秒时间戳：毫秒通常是 13 位（> 2e10），秒通常是 10 位
  const ms = n > 2e10 ? n : n * 1000;
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function pickFirstString(...vals) {
  for (const v of vals) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
}

function normalizeInlineText(s) {
  // 把多余空白压缩成单个空格，避免出现换行/多个空格
  return String(s || "").replace(/\s+/g, " ").trim();
}

function formatTimeLocationLine(prefix, timeText, locationText) {
  if (!timeText && !locationText) return "";
  if (timeText && locationText) return `${prefix} ${timeText}・${locationText}`;
  if (timeText) return `${prefix} ${timeText}`;
  return `${prefix} ${locationText}`;
}

function parseZvideoMetaLine(metaText) {
  const s = String(metaText || "").trim();
  // 例：发布于 2024-02-06 11:30・河北・2.6 万次播放
  const m = s.match(/^(发布于|编辑于)\s*([^・]+?)\s*・\s*([^・]+?)(?:\s*・\s*(.+))?$/);
  if (m) {
    return {
      prefix: m[1],
      timeText: (m[2] || "").trim(),
      locationText: (m[3] || "").trim(),
      restText: (m[4] || "").trim()
    };
  }
  return { prefix: "", timeText: "", locationText: "", restText: "" };
}

async function fetchZvideoMetaFromPage(baseUrl) {
  const resp = await fetch(baseUrl, { credentials: "include" });
  if (!resp.ok) throw new Error(`zvideo page ${resp.status}: ${baseUrl}`);
  const html = await resp.text();

  const meta = await extractTextFromHtmlOffscreen(html, ".ZVideo-meta");
  if (meta) return meta;

  // 兜底：结构变更时仍尽力匹配
  const meta2 = await extractTextFromHtmlOffscreen(html, '[class*="ZVideo-meta"]');
  return meta2 || "";
}

async function fetchContentItemTimeFromPage(pageUrl) {
  // 从文章/回答页面 HTML 中提取“发布于/编辑于 + 时间 + 地点”所在的 .ContentItem-time
  const html = await zhihuPageGetHtml(pageUrl);

  const selectors = [
    "article .ContentItem-time",
    ".Post-Main .ContentItem-time",
    ".AnswerItem .ContentItem-time",
    ".ContentItem .ContentItem-time",
    ".ContentItem-time"
  ];

  for (const sel of selectors) {
    try {
      const t = normalizeInlineText(await extractTextFromHtmlOffscreen(html, sel));
      if (t) return t;
    } catch (_) {
      // selector 不存在/解析失败：继续尝试下一个
    }
  }
  return "";
}

function buildFrontMatter({ title, author, url }) {
  // 与 content_extract.js 保持一致（Obsidian 友好 YAML）
  const esc = (s) => String(s || "").replace(/"/g, '\\"');
  const lines = [
    "---",
    `title: "${esc(title)}"`,
    author ? `author: "${esc(author)}"` : null,
    `source: "${esc(url)}"`,
    `exported_at: "${new Date().toISOString()}"`,
    "---"
  ].filter((x) => x !== null && x !== undefined);
  return lines.join("\n") + "\n";
}

async function zhihuAnswerToMarkdown(answerId) {
  const include = [
    "content",
    "created_time",
    "updated_time",
    "author.name",
    "question.id",
    "question.title"
  ].join(",");
  const api = `https://www.zhihu.com/api/v4/answers/${answerId}?include=${encodeURIComponent(
    include
  )}`;

  let data = null;
  try {
    data = await zhihuApiGet(api);
  } catch (e) {
    // 403 常见原因：登录态缺失/接口风控/内容权限不足。
    // 为了不让“单条 403 直接失败”，这里自动降级：抓取回答页面并从 initialState 解析内容。
    if (Number(e?.status) === 403) {
      return await zhihuAnswerToMarkdownViaPage(answerId);
    }
    throw e;
  }

  const title = String(data?.question?.title || "").trim() || "Untitled";
  const author = String(data?.author?.name || "").trim();
  const html = String(data?.content || "");

  const qid = data?.question?.id;
  const url = qid
    ? `https://www.zhihu.com/question/${qid}/answer/${answerId}`
    : `https://www.zhihu.com/answer/${answerId}`;

  const bodyMd = await convertHtmlToMarkdownOffscreen(html, url);

  const updated = formatLocalDateTime(data?.updated_time);
  const created = formatLocalDateTime(data?.created_time);
  const contentTimeText = updated ? `编辑于 ${updated}` : created ? `发布于 ${created}` : "";

  const fileBaseName = `${title}${author ? " - " + author : ""}`;
  const md =
    buildFrontMatter({ title, author, url }) +
    "\n" +
    (bodyMd ? bodyMd + "\n" : "") +
    (contentTimeText ? "\n" + contentTimeText + "\n" : "");

  return { ok: true, md, title, url, fileBaseName, contentTimeText };
}

async function zhihuArticleToMarkdown(articleId) {
  const include = ["content", "title", "created_time", "updated_time", "author.name"].join(",");
  const api = `https://www.zhihu.com/api/v4/articles/${articleId}?include=${encodeURIComponent(
    include
  )}`;
  const data = await zhihuApiGet(api);

  const title = String(data?.title || "").trim() || "Untitled";
  const author = String(data?.author?.name || "").trim();
  const html = String(data?.content || "");
  const url = `https://zhuanlan.zhihu.com/p/${articleId}`;

  const bodyMd = await convertHtmlToMarkdownOffscreen(html, url);

  // 文章 API 字段在不同版本/环境下可能是 created/updated 或 created_time/updated_time
  const updated = formatLocalDateTime(
    data?.updated_time ?? data?.updatedTime ?? data?.updated
  );
  const created = formatLocalDateTime(
    data?.created_time ?? data?.createdTime ?? data?.created
  );
  const apiTimeText = updated ? `编辑于 ${updated}` : created ? `发布于 ${created}` : "";

  // 关键：从页面 .ContentItem-time 兜底拿“时间 + 地点”（例：发布于 2025-12-30 23:34・广东）
  let pageTimeText = "";
  try {
    pageTimeText = await fetchContentItemTimeFromPage(url);
  } catch (_) {}

  const contentTimeText = pageTimeText || apiTimeText;

  const fileBaseName = `${title}${author ? " - " + author : ""}`;
  const md =
    buildFrontMatter({ title, author, url }) +
    "\n" +
    (bodyMd ? bodyMd + "\n" : "") +
    (contentTimeText ? "\n" + contentTimeText + "\n" : "");

  return { ok: true, md, title, url, fileBaseName, contentTimeText };
}

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function zhihuPinToMarkdown(pinId) {
  const baseUrl = `https://www.zhihu.com/pin/${pinId}`;
  const include = ["content", "created_time", "updated_time", "author.name", "title", "excerpt_title"].join(
    ","
  );
  let data = null;
  try {
    data = await zhihuApiGet(
      `https://www.zhihu.com/api/v4/pins/${pinId}?include=${encodeURIComponent(include)}`
    );
  } catch (_) {
    data = await zhihuApiGet(`https://www.zhihu.com/api/v4/pins/${pinId}`);
  }

  const author = String(data?.author?.name || "").trim();
  const html = String(data?.content || "");
  const titleFromApi = String(data?.title || data?.excerpt_title || "").trim();
  const title = titleFromApi || (stripHtmlTags(html).slice(0, 50) || "Untitled");

  const bodyMd = html ? await convertHtmlToMarkdownOffscreen(html, baseUrl) : "";
  const updated = formatLocalDateTime(data?.updated_time);
  const created = formatLocalDateTime(data?.created_time);
  const contentTimeText = updated ? `编辑于 ${updated}` : created ? `发布于 ${created}` : "";

  const fileBaseName = `${title}${author ? " - " + author : ""}`;
  const md =
    buildFrontMatter({ title, author, url: baseUrl }) +
    "\n" +
    (bodyMd ? bodyMd + "\n" : "") +
    (contentTimeText ? "\n" + contentTimeText + "\n" : "");

  return { ok: true, md, title, url: baseUrl, fileBaseName, contentTimeText };
}

async function zhihuZvideoToMarkdown(zvideoId) {
  const baseUrl = `https://www.zhihu.com/zvideo/${zvideoId}`;
  const include = [
    "title",
    "created_time",
    "updated_time",
    "description",
    "author.name",
    // 位置字段在不同返回里名字不一，这里尽量 request，服务端不认识会忽略
    "ip_location",
    "ip_location.name",
    "ip_location_name",
    "cover_url",
    "cover.url",
    "thumbnail_url",
    "play_url"
  ].join(",");

  let data = null;
  try {
    data = await zhihuApiGet(
      `https://www.zhihu.com/api/v4/zvideos/${zvideoId}?include=${encodeURIComponent(include)}`
    );
  } catch (_) {
    data = await zhihuApiGet(`https://www.zhihu.com/api/v4/zvideos/${zvideoId}`);
  }

  const title = String(data?.title || "").trim() || `ZVideo_${zvideoId}`;
  const author = String(data?.author?.name || "").trim();
  const coverUrl = pickFirstString(
    data?.cover_url,
    data?.cover?.url,
    data?.cover?.original,
    data?.thumbnail_url,
    data?.thumbnail?.url,
    data?.image_url,
    data?.image?.url,
    data?.video?.cover_url,
    data?.video?.thumbnail_url,
    data?.video?.cover?.url
  );
  const playUrl = pickFirstString(data?.play_url, data?.video?.play_url, data?.video?.url);
  const locationText = pickFirstString(
    data?.ip_location?.name,
    data?.ip_location_name,
    data?.ip_location,
    data?.location,
    data?.author?.ip_location?.name,
    data?.author?.ip_location_name
  );

  const desc = data?.description ?? data?.content ?? "";
  const descStr = String(desc || "");
  const descLooksHtml = /<\/?[a-z][\s\S]*>/i.test(descStr);
  const descMd = descLooksHtml
    ? await convertHtmlToMarkdownOffscreen(descStr, baseUrl)
    : (descStr ? descStr.trim() : "");

  const updated = formatLocalDateTime(data?.updated_time);
  const created = formatLocalDateTime(data?.created_time);
  const contentTimeText = updated
    ? formatTimeLocationLine("编辑于", updated, locationText)
    : created
      ? formatTimeLocationLine("发布于", created, locationText)
      : (locationText ? formatTimeLocationLine("发布于", "", locationText) : "");

  // 兜底：API 不给时间/地点时，从页面 .ZVideo-meta 中提取（不打开 tab）
  let finalTimeLine = contentTimeText;
  if (!finalTimeLine) {
    try {
      const metaLine = await fetchZvideoMetaFromPage(baseUrl);
      const parsed = parseZvideoMetaLine(metaLine);
      // 只保留“发布于/编辑于 + 时间 + 地点”，忽略播放量等尾巴
      if (parsed?.prefix && (parsed.timeText || parsed.locationText)) {
        finalTimeLine = formatTimeLocationLine(parsed.prefix, parsed.timeText, parsed.locationText);
      }
    } catch (_) {}
  }

  const fileBaseName = `${title}${author ? " - " + author : ""}`;

  const lines = [];
  lines.push(buildFrontMatter({ title, author, url: baseUrl }));
  lines.push("");
  lines.push(`[在知乎观看](${baseUrl})`);
  if (playUrl) lines.push(`直链：${playUrl}`);
  if (coverUrl) lines.push(`\n<img src="${coverUrl}" width="800">`);
  if (descMd) lines.push("\n" + descMd);
  if (finalTimeLine) lines.push("\n" + finalTimeLine);
  const md = lines.join("\n") + "\n";

  return { ok: true, md, title, url: baseUrl, fileBaseName, contentTimeText: finalTimeLine };
}

// 可选：按收藏夹分目录保存（Chrome 下载会创建子目录）
function buildFolderName(prefix) {
  return safePath(prefix);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // Offscreen 文档专用消息：background 不处理，避免抢答导致 offscreen 收不到响应
      if (typeof msg?.type === "string" && msg.type.startsWith("OFFSCREEN_")) {
        return;
      }

      if (msg?.type === "GET_COLLECTION_TOTAL") {
        const { collectionId } = msg || {};
        if (!collectionId) {
          sendResponse({ ok: false, error: "missing collectionId" });
          return;
        }
        const total = await getCollectionTotal(collectionId);
        sendResponse({ ok: true, total });
        return;
      }

      if (msg?.type === "EXPORT_ONE_COLLECTION") {
        const { collectionId, collectionTitle, originTabId, limit = 200 } = msg;
        const delay = FIXED_DELAY_MS;
        const notifyGuard = await createActiveTabNotifyGuard(originTabId);

        try {
          const startTs = Date.now();
          const items = await listCollectionItems(collectionId, limit);
          const total = items.length;
          let processed = 0;
          let okCount = 0;
          let failCount = 0;

          const title = String(collectionTitle || "").trim();
          const folderBase = title ? `知乎收藏夹_${title}` : `知乎收藏夹_${collectionId}`;
          const folder = buildFolderName(folderBase);
          // UI/通知里显示收藏夹名称，和 popup 顶部保持一致；无名称再回退到 id
          const scopeTitle = title ? `收藏夹“${title}”` : `收藏夹 #${collectionId}`;
          // Windows 通知过于频繁会打扰用户：这里对“进度通知”做节流（start/done 仍会通知）
          const shouldNotify = makeProgressThrottler({ everyN: 10, minIntervalMs: 5000 });

          if (notifyGuard.isEnabled()) notifyStart(scopeTitle, total);
          pushUiProgress({
            scopeTitle,
            stage: "start",
            processed: 0,
            total,
            ok: 0,
            failed: 0
          });

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const c = item?.content;
            const url = itemToUrl(item) || "";
            let file = "";
            let lastName = "";
            try {
              let extracted = null;
              if (c?.type === "answer" && c.id) {
                extracted = await zhihuAnswerToMarkdown(c.id);
              } else if (c?.type === "article" && c.id) {
                extracted = await zhihuArticleToMarkdown(c.id);
              } else if (c?.type === "pin" && c.id) {
                extracted = await zhihuPinToMarkdown(c.id);
              } else if (c?.type === "zvideo" && c.id) {
                extracted = await zhihuZvideoToMarkdown(c.id);
              } else {
                extracted = null;
              }

              if (extracted?.ok && extracted.md && extracted.fileBaseName) {
                lastName = extracted.fileBaseName;
                file = `${folder}/${safeFilename(extracted.fileBaseName)}.md`;
                await downloadMarkdownFile(file, extracted.md);
                okCount++;
              } else {
                failCount++;
              }
            } catch (e) {
              console.error(
                "export one item failed:",
                url,
                "file:",
                JSON.stringify(file),
                "len:",
                String(file || "").length,
                e
              );
              failCount++;
            }

            processed++;

            if (shouldNotify(processed) && notifyGuard.isEnabled()) {
              notifyProgress(scopeTitle, processed, total, okCount, failCount);
            }

            pushUiProgress({
              scopeTitle,
              stage: "progress",
              processed,
              total,
              ok: okCount,
              failed: failCount,
              lastUrl: url,
              lastFileBaseName: lastName,
              lastFile: file
            });

            await sleep(delay);
          }

          // 记录一次统计：剔除 delay 后的平均耗时（供 popup 预估使用）
          try {
            const endTs = Date.now();
            const elapsedSec = (endTs - startTs) / 1000;
            const delaySec = (Number(delay) || 0) / 1000 * urls.length;
            const coreElapsedSec = Math.max(0, elapsedSec - delaySec);
            const coreAvgSecPerItem = items.length ? coreElapsedSec / items.length : 3;
            await chrome.storage.local.set({
              zhihuExporterStats: {
                coreAvgSecPerItem,
                updatedAt: new Date().toISOString()
              }
            });
          } catch (_) {}

          if (notifyGuard.isEnabled()) notifyDone(scopeTitle, processed, total, okCount, failCount);
          pushUiProgress({
            scopeTitle,
            stage: "done",
            processed,
            total,
            ok: okCount,
            failed: failCount
          });
          sendResponse({ ok: true, filename: `${folder}/...`, count: okCount });
          return;
        } finally {
          notifyGuard.dispose();
        }
      }

      if (msg?.type === "EXPORT_ALL_COLLECTIONS") {
        const { urlToken, originTabId, limit = 200 } = msg;
        const delay = FIXED_DELAY_MS;
        const notifyGuard = await createActiveTabNotifyGuard(originTabId);

        try {
          const startTs = Date.now();
          const collections = await listMemberCollections(urlToken, 200);
          let okCount = 0;
          let failCount = 0;
          let processed = 0;
          let total = 0;

          const scopeTitle = `用户 ${urlToken} 全部收藏夹`;
          // Windows 通知过于频繁会打扰用户：对“进度通知”做节流（start/done 仍会通知）
          const shouldNotify = makeProgressThrottler({ everyN: 10, minIntervalMs: 5000 });

          if (notifyGuard.isEnabled()) notifyStart(scopeTitle, 0); // total 先未知，后面动态更新
          pushUiProgress({
            scopeTitle,
            stage: "start",
            processed: 0,
            total: 0,
            ok: 0,
            failed: 0
          });

          for (const col of collections) {
            const cid = col.id;
            const title = col.title || String(cid);
            const folder = buildFolderName(`zhihu_${urlToken}/${title}_${cid}`);

            const items = await listCollectionItems(cid, limit);
            total += items.length;

            // 每次发现新增总量，顺便更新一下通知（不频繁）
            if (notifyGuard.isEnabled()) {
              notifyProgress(scopeTitle, processed, total, okCount, failCount);
            }
            pushUiProgress({
              scopeTitle,
              stage: "progress",
              processed,
              total,
              ok: okCount,
              failed: failCount,
              currentCollectionId: cid,
              currentCollectionTitle: title
            });

            for (const item of items) {
              const c = item?.content;
              const url = itemToUrl(item) || "";
              try {
                let extracted = null;
                if (c?.type === "answer" && c.id) {
                  extracted = await zhihuAnswerToMarkdown(c.id);
                } else if (c?.type === "article" && c.id) {
                  extracted = await zhihuArticleToMarkdown(c.id);
                } else if (c?.type === "pin" && c.id) {
                  extracted = await zhihuPinToMarkdown(c.id);
                } else if (c?.type === "zvideo" && c.id) {
                  extracted = await zhihuZvideoToMarkdown(c.id);
                } else {
                  extracted = null;
                }

                if (extracted?.ok && extracted.md && extracted.fileBaseName) {
                  const file = `${folder}/${safeFilename(extracted.fileBaseName)}.md`;
                  await downloadMarkdownFile(file, extracted.md);
                  okCount++;
                  processed++;

                  // popup 需要“每完成一个文件就更新”的状态
                  pushUiProgress({
                    scopeTitle,
                    stage: "progress",
                    processed,
                    total,
                    ok: okCount,
                    failed: failCount,
                    currentCollectionId: cid,
                    currentCollectionTitle: title,
                    lastUrl: url,
                    lastFileBaseName: extracted.fileBaseName,
                    lastFile: file
                  });

                  if (shouldNotify(processed) && notifyGuard.isEnabled()) {
                    notifyProgress(scopeTitle, processed, total, okCount, failCount);
                  }
                } else {
                  failCount++;
                  processed++;
                  pushUiProgress({
                    scopeTitle,
                    stage: "progress",
                    processed,
                    total,
                    ok: okCount,
                    failed: failCount,
                    currentCollectionId: cid,
                    currentCollectionTitle: title,
                    lastUrl: url
                  });
                  if (shouldNotify(processed) && notifyGuard.isEnabled()) {
                    notifyProgress(scopeTitle, processed, total, okCount, failCount);
                  }
                }
              } catch (e) {
                console.error("export item failed:", url, e);
                failCount++;
                processed++;
                pushUiProgress({
                  scopeTitle,
                  stage: "progress",
                  processed,
                  total,
                  ok: okCount,
                  failed: failCount,
                  currentCollectionId: cid,
                  currentCollectionTitle: title,
                  lastUrl: url
                });
                if (shouldNotify(processed) && notifyGuard.isEnabled()) {
                  notifyProgress(scopeTitle, processed, total, okCount, failCount);
                }
              }

              await sleep(delay);
            }

            await sleep(400);
          }

          sendResponse({
            ok: true,
            filename: `zhihu_${urlToken}/...`,
            count: okCount
          });

          if (notifyGuard.isEnabled()) {
            notifyDoneText({
              title: "知乎全部收藏导出完成",
              message: `用户 ${urlToken}：成功导出 ${okCount} 篇回答`
            });
          }

          pushUiProgress({
            scopeTitle,
            stage: "done",
            processed,
            total,
            ok: okCount,
            failed: failCount
          });

          // 同样记录一次统计（剔除 delay）
          try {
            const endTs = Date.now();
            const elapsedSec = (endTs - startTs) / 1000;
            const delaySec = (Number(delay) || 0) / 1000 * processed;
            const coreElapsedSec = Math.max(0, elapsedSec - delaySec);
            const coreAvgSecPerItem = processed ? coreElapsedSec / processed : 3;
            await chrome.storage.local.set({
              zhihuExporterStats: {
                coreAvgSecPerItem,
                updatedAt: new Date().toISOString()
              }
            });
          } catch (_) {}

          return;
        } finally {
          notifyGuard.dispose();
        }
      }

      sendResponse({ ok: false, error: "unknown message type" });
    } catch (e) {
      console.error(e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
