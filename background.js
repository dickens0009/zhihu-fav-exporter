function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function listMemberCollections(urlToken, limit = 200) {
  const out = [];
  let offset = 0;
  const pageSize = 20;

  while (out.length < limit) {
    const api = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(
      urlToken
    )}/collections?offset=${offset}&limit=${pageSize}`;
    const data = await zhihuApiGet(api);
    const arr = data?.data || [];
    out.push(...arr);
    if (arr.length < pageSize) break;
    offset += pageSize;
    await sleep(250);
  }
  return out.slice(0, limit);
}

async function listCollectionItems(collectionId, limit = 200) {
  const out = [];
  let offset = 0;
  const pageSize = 20;

  while (out.length < limit) {
    const api = `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=${offset}&limit=${pageSize}`;
    const data = await zhihuApiGet(api);
    const arr = data?.data || [];
    out.push(...arr);
    if (arr.length < pageSize) break;
    offset += pageSize;
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

async function openHiddenTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await waitTabComplete(tab.id);
  return tab;
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractFromTab(tabId) {
  return await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE" }).catch(() => null);
}

// 可选：按收藏夹分目录保存（Chrome 下载会创建子目录）
function buildFolderName(prefix) {
  return safePath(prefix);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "EXPORT_ONE_COLLECTION") {
        const { collectionId, delay = 1200, limit = 200 } = msg;

        const items = await listCollectionItems(collectionId, limit);
        const urls = items.map(itemToUrl).filter(Boolean);
        
        const total = urls.length;
        let processed = 0;
        let okCount = 0;
        let failCount = 0;
        
        const folder = buildFolderName(`zhihu_collection_${collectionId}`);
        const scopeTitle = `收藏夹 ${collectionId}`;
        const shouldNotify = makeProgressThrottler({ everyN: 10, minIntervalMs: 3000 });
        
        notifyStart(scopeTitle, total);
        
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          let file = "";
          try {
            const tab = await openHiddenTab(url);
            await sleep(800);
        
            const extracted = await extractFromTab(tab.id);
            await chrome.tabs.remove(tab.id);
        
            if (extracted?.ok && extracted.md && extracted.fileBaseName) {
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

          if (shouldNotify(processed)) {
            notifyProgress(scopeTitle, processed, total, okCount, failCount);
          }
        
          if (shouldNotify(processed)) {
            notifyProgress(scopeTitle, processed, total, okCount, failCount);
          }
        
          await sleep(delay);
        }
        
        notifyDone(scopeTitle, processed, total, okCount, failCount);
        sendResponse({ ok: true, filename: `zhihu_collection_${collectionId}/...`, count: okCount });
        return;
      }

      if (msg?.type === "EXPORT_ALL_COLLECTIONS") {
        const { urlToken, delay = 1200, limit = 200 } = msg;

        const collections = await listMemberCollections(urlToken, 200);
        let okCount = 0;
        let failCount = 0;
        let processed = 0;
        let total = 0;

        const scopeTitle = `用户 ${urlToken} 全部收藏夹`;
        const shouldNotify = makeProgressThrottler({ everyN: 10, minIntervalMs: 3000 });

        notifyStart(scopeTitle, 0); // total 先未知，后面动态更新

        for (const col of collections) {
          const cid = col.id;
          const title = col.title || String(cid);
          const folder = buildFolderName(`zhihu_${urlToken}/${title}_${cid}`);

          const items = await listCollectionItems(cid, limit);
          const urls = items.map(itemToUrl).filter(Boolean);
          total += urls.length;

          
          // 每次发现新增总量，顺便更新一下通知（不频繁）
          notifyProgress(scopeTitle, processed, total, okCount, failCount);

          for (const url of urls) {
            try {
              const tab = await openHiddenTab(url);
              await sleep(800);

              const extracted = await extractFromTab(tab.id);
              await chrome.tabs.remove(tab.id);

              if (extracted?.ok && extracted.md && extracted.fileBaseName) {
                const file = `${folder}/${safeFilename(extracted.fileBaseName)}.md`;
                await downloadMarkdownFile(file, extracted.md);
                okCount++;
              }
            } catch (e) {
              console.error("export item failed:", url, e);
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

        notifyDoneText({
          title: "知乎全部收藏导出完成",
          message: `用户 ${urlToken}：成功导出 ${okCount} 篇回答`
        });

        return;
      }

      sendResponse({ ok: false, error: "unknown message type" });
    } catch (e) {
      console.error(e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
