const $ = (id) => document.getElementById(id);

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(msg) {
  $("status").textContent = msg;
}

async function getContext(tabId) {
  return await chrome.tabs.sendMessage(tabId, { type: "GET_CONTEXT" }).catch(() => null);
}

async function exportThisCollection() {
  const tab = await getActiveTab();
  if (!tab?.id) return setStatus("未找到当前标签页");

  const ctxResp = await getContext(tab.id);
  const ctx = ctxResp?.ctx;

  const delay = Number($("delay").value || 1200);
  const limit = Number($("limit").value || 200);

  if (!ctx || ctx.pageType !== "collection" || !ctx.collectionId) {
    return setStatus("请打开某个具体收藏夹页面（形如 https://www.zhihu.com/collection/xxxx）再点此按钮");
  }

  setStatus(`开始导出收藏夹 ${ctx.collectionId} …`);
  const resp = await chrome.runtime.sendMessage({
    type: "EXPORT_ONE_COLLECTION",
    collectionId: ctx.collectionId,
    delay,
    limit
  });

  if (!resp?.ok) return setStatus("导出失败：" + (resp?.error || "未知错误"));
  setStatus(`完成 ✅\n文件：${resp.filename}\n成功条目：${resp.count}`);
}

async function exportAllCollections() {
  const tab = await getActiveTab();
  if (!tab?.id) return setStatus("未找到当前标签页");

  const ctxResp = await getContext(tab.id);
  const ctx = ctxResp?.ctx;

  const delay = Number($("delay").value || 1200);
  const limit = Number($("limit").value || 200);

  if (!ctx || ctx.pageType !== "member_collections" || !ctx.urlToken) {
    return setStatus("请打开用户收藏夹列表页（形如 https://www.zhihu.com/people/<token>/collections）再点此按钮");
  }

  setStatus(`开始导出用户 ${ctx.urlToken} 的全部收藏夹…`);
  const resp = await chrome.runtime.sendMessage({
    type: "EXPORT_ALL_COLLECTIONS",
    urlToken: ctx.urlToken,
    delay,
    limit
  });

  if (!resp?.ok) return setStatus("导出失败：" + (resp?.error || "未知错误"));
  setStatus(`完成 ✅\n文件：${resp.filename}\n成功条目：${resp.count}`);
}

$("exportThisCollection").addEventListener("click", exportThisCollection);
$("exportAllCollections").addEventListener("click", exportAllCollections);
