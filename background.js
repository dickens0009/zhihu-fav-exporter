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
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${url}`);
  return await resp.json();
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

function formatLocalDateTime(tsSec) {
  const n = Number(tsSec);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n * 1000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
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
  const data = await zhihuApiGet(api);

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
