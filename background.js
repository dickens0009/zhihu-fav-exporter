function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function safeFilename(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function zhihuApiGet(url) {
  // 关键：credentials: "include" 使用你当前登录态的 cookie
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${url}`);
  return await resp.json();
}

async function listMemberCollections(urlToken, limit = 20) {
  const out = [];
  let offset = 0;
  const pageSize = Math.min(20, limit);

  while (out.length < limit) {
    const api = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(urlToken)}/collections?offset=${offset}&limit=${pageSize}`;
    const data = await zhihuApiGet(api);
    const arr = data?.data || [];
    out.push(...arr);
    if (arr.length < pageSize) break;
    offset += pageSize;
    await sleep(300);
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
    await sleep(300);
  }
  return out.slice(0, limit);
}

function itemToUrl(item) {
  // item.content.type 常见：answer / article / zvideo / pin
  const c = item?.content;
  if (!c) return null;

  const t = c.type;
  if (t === "answer") {
    const aid = c.id;
    const qid = c.question?.id;
    if (qid && aid) return `https://www.zhihu.com/question/${qid}/answer/${aid}`;
    // 兜底：若 API 没给 question.id，就用 item.url（有些版本会提供）
    if (item?.url) return item.url;
    return null;
  }

  if (t === "article") {
    const id = c.id;
    if (id) return `https://zhuanlan.zhihu.com/p/${id}`;
    if (item?.url) return item.url;
    return null;
  }

  if (t === "zvideo") {
    const id = c.id;
    if (id) return `https://www.zhihu.com/zvideo/${id}`;
    if (item?.url) return item.url;
    return null;
  }

  if (t === "pin") {
    const id = c.id;
    if (id) return `https://www.zhihu.com/pin/${id}`;
    if (item?.url) return item.url;
    return null;
  }

  // 其他类型先兜底
  if (item?.url) return item.url;
  return null;
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

async function downloadMarkdown(filename, content) {
    // 用 data URL，避免 service worker 里 createObjectURL 不可用的问题
    const dataUrl =
      "data:text/markdown;charset=utf-8," + encodeURIComponent(content);
  
    try {
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: true
      });
      console.log("download started, id=", downloadId);
    } catch (e) {
      console.error("downloads.download failed:", e);
      throw e;
    }
  }
  

function frontMatter(meta) {
  return (
    `---\n` +
    `title: "${meta.title}"\n` +
    `source: "${meta.source}"\n` +
    `exported_at: "${new Date().toISOString()}"\n` +
    `---\n\n`
  );
}

async function exportUrlsToOneMd(urls, meta, delay) {
  let md = frontMatter(meta) + `# ${meta.title}\n\n`;
  let okCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const tab = await openHiddenTab(url);
      await sleep(600);
      const extracted = await extractFromTab(tab.id);

      if (extracted?.ok && extracted.md) {
        md += extracted.md;
        okCount++;
      } else {
        md += `## 未能提取\n\n- 链接：${url}\n\n> 可能需要登录/被风控/页面结构变化\n\n---\n\n`;
      }

      await chrome.tabs.remove(tab.id);
    } catch (e) {
      md += `## 导出错误\n\n- 链接：${url}\n\n> ${String(e)}\n\n---\n\n`;
    }

    await sleep(delay);
  }

  return { md, okCount };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "EXPORT_ONE_COLLECTION") {
        const { collectionId, delay, limit } = msg;
        const items = await listCollectionItems(collectionId, limit);
        const urls = items.map(itemToUrl).filter(Boolean);

        const title = `zhihu_collection_${collectionId}`;
        const { md, okCount } = await exportUrlsToOneMd(
          urls,
          { title, source: `https://www.zhihu.com/collection/${collectionId}` },
          delay
        );

        const filename = `${safeFilename(title)}.md`;
        console.log("Export done. Start download:", filename, "chars:", md.length);
        await downloadMarkdown(filename, md);
        console.log("Download triggered:", filename);
        sendResponse({ ok: true, filename, count: okCount });
        return;
      }

      if (msg?.type === "EXPORT_ALL_COLLECTIONS") {
        const { urlToken, delay, limit } = msg;

        const collections = await listMemberCollections(urlToken, 200); // 列表页一般不会太多
        // 每个收藏夹取 limit 条
        const allUrls = [];
        for (const col of collections) {
          const cid = col.id;
          const items = await listCollectionItems(cid, limit);
          const urls = items.map(itemToUrl).filter(Boolean);

          allUrls.push(`\n\n# 收藏夹：${col.title || cid}\n\n`);
          allUrls.push(...urls.map((u) => `URL::${u}`));
          await sleep(400);
        }

        // 将 URL:: 行解析后逐条导出（同时保留收藏夹分组标题）
        const lines = allUrls;
        let md = frontMatter({
          title: `zhihu_collections_${urlToken}`,
          source: `https://www.zhihu.com/people/${urlToken}/collections`
        }) + `# 知乎收藏导出：${urlToken}\n\n`;

        let okCount = 0;

        for (const line of lines) {
          if (!line.startsWith("URL::")) {
            md += line;
            continue;
          }
          const url = line.slice("URL::".length);

          try {
            const tab = await openHiddenTab(url);
            await sleep(600);
            const extracted = await extractFromTab(tab.id);

            if (extracted?.ok && extracted.md) {
              md += extracted.md;
              okCount++;
            } else {
              md += `## 未能提取\n\n- 链接：${url}\n\n> 可能需要登录/被风控/页面结构变化\n\n---\n\n`;
            }

            await chrome.tabs.remove(tab.id);
          } catch (e) {
            md += `## 导出错误\n\n- 链接：${url}\n\n> ${String(e)}\n\n---\n\n`;
          }

          await sleep(delay);
        }

        const filename = `${safeFilename(`zhihu_collections_${urlToken}`)}.md`;
        console.log("Export done. Start download:", filename, "chars:", md.length);
        await downloadMarkdown(filename, md);
        console.log("Download triggered:", filename);
        sendResponse({ ok: true, filename, count: okCount });
        return;
      }

      sendResponse({ ok: false, error: "unknown message type" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
