const $ = (id) => document.getElementById(id);

// 每篇导出之间的固定间隔（不再让用户在 UI 里配置）
const FIXED_DELAY_MS = 1000;

// 收藏夹页：缓存标题与总数，避免依赖 DOM 元素（也便于重绘提示文案）
let cachedCollectionTitle = "";
let cachedCollectionTotal = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setHint(msg) {
  const el = $("pageHint");
  if (!el) return;
  el.textContent = msg || "";
}

function setStatus(msg) {
  $("status").textContent = msg;
}

function formatProgress(p) {
  const title = p?.scopeTitle ? `${p.scopeTitle}\n` : "";
  const done = Number(p?.processed ?? 0);
  const total = Number(p?.total ?? 0);
  const ok = Number(p?.ok ?? 0);
  const failed = Number(p?.failed ?? 0);
  const pct = total ? Math.floor((done / total) * 100) : 0;
  const last = p?.lastFileBaseName ? `\n最近：${p.lastFileBaseName}` : "";
  return `${title}进度：${done}/${total}（${pct}%）\n成功：${ok}  失败：${failed}${last}`;
}

// 后台推送的实时进度（popup 打开时会收到）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "UI_PROGRESS") return;
  const p = msg.payload || {};
  if (p.stage === "start") {
    setStatus("开始导出…\n" + formatProgress(p));
    return;
  }
  if (p.stage === "done") {
    setStatus("完成 ✅\n" + formatProgress(p));
    return;
  }
  setStatus(formatProgress(p));
});

async function getContext(tabId) {
  return await chrome.tabs.sendMessage(tabId, { type: "GET_CONTEXT" }).catch(() => null);
}

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(ss).padStart(2, "0")}s`;
  return `${ss}s`;
}

function readDelayMs() {
  return FIXED_DELAY_MS;
}

function readLimitN() {
  return Math.max(1, Number($("limit").value || 200));
}

function getRangeMode() {
  // latest | all
  return $("rangeAll")?.checked ? "all" : "latest";
}

function updateEstimate({ totalItems }) {
  const total = Number(totalItems);
  const hasTotal = Number.isFinite(total) && total > 0;
  // 预计耗时：按“每条固定耗时 FIXED_DELAY_MS”线性估算
  const perItemSec = readDelayMs() / 1000;

  const estimateEl = $("estimate");
  if (!estimateEl) return;

  if (getRangeMode() === "all") {
    if (!hasTotal) {
      estimateEl.textContent = "等待获取总数…";
      return;
    }
    const n = total;
    estimateEl.textContent = `${fmtDuration(n * perItemSec)}（按 ${n} 条）`;
    return;
  }

  const n0 = readLimitN();
  const n = hasTotal ? Math.min(n0, total) : n0;
  estimateEl.textContent = `${fmtDuration(n * perItemSec)}（按 ${n} 条）`;
}

async function refreshCollectionTotal(collectionId) {
  const resp = await chrome.runtime
    .sendMessage({ type: "GET_COLLECTION_TOTAL", collectionId })
    .catch(() => null);
  if (!resp?.ok) {
    return null;
  }
  const total = Number(resp.total ?? 0);
  return total;
}

async function exportThisCollection() {
  const tab = await getActiveTab();
  if (!tab?.id) return setStatus("未找到当前标签页");

  const ctxResp = await getContext(tab.id);
  const ctx = ctxResp?.ctx;

  let limit = Number($("limit").value || 200);

  if (!ctx || ctx.pageType !== "collection" || !ctx.collectionId) {
    return setStatus("请打开某个具体收藏夹页面（形如 https://www.zhihu.com/collection/xxxx）再点此按钮");
  }

  const collectionTitle =
    String(ctx.collectionTitle || cachedCollectionTitle || "").trim() || "";

  // 如果用户选择“全部”，则以后台查询到的总数为准
  if (getRangeMode() === "all") {
    const total = Number(cachedCollectionTotal);
    if (!Number.isFinite(total) || total <= 0) {
      return setStatus("当前选择“下载全部”，但还没获取到总条目数（或查询失败），请稍等/刷新后再试");
    }
    limit = total;
  }

  // 底部状态与顶部一致：优先显示收藏夹名称；没有名称才回退到 id
  const shownTitle = collectionTitle || `#${ctx.collectionId}`;
  setStatus(`开始导出收藏夹“${shownTitle}” …`);
  const resp = await chrome.runtime.sendMessage({
    type: "EXPORT_ONE_COLLECTION",
    collectionId: ctx.collectionId,
    collectionTitle,
    originTabId: tab.id,
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

  const limit = Number($("limit").value || 200);

  if (!ctx || ctx.pageType !== "member_collections" || !ctx.urlToken) {
    return setStatus("请打开用户收藏夹列表页（形如 https://www.zhihu.com/people/<token>/collections）再点此按钮");
  }

  setStatus(`开始导出用户 ${ctx.urlToken} 的全部收藏夹…`);
  const resp = await chrome.runtime.sendMessage({
    type: "EXPORT_ALL_COLLECTIONS",
    urlToken: ctx.urlToken,
    originTabId: tab.id,
    limit
  });

  if (!resp?.ok) return setStatus("导出失败：" + (resp?.error || "未知错误"));
  setStatus(`完成 ✅\n文件：${resp.filename}\n成功条目：${resp.count}`);
}

$("exportThisCollection").addEventListener("click", exportThisCollection);
$("exportAllCollections").addEventListener("click", exportAllCollections);

// 弹窗打开即检测当前页面，并在“收藏夹页”展示总数 + 预计耗时
(async function initPopup() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setHint("未找到当前标签页");
    return;
  }

  const ctxResp = await getContext(tab.id);
  const ctx = ctxResp?.ctx;

  let totalItems = null;

  const limitRowEl = $("limitRow");
  const btnsEl = $("btns");

  // 默认：先隐藏收藏夹专属 UI
  const infoEl = $("collectionInfo");
  const allRowEl = $("downloadAllRow");
  if (infoEl) infoEl.style.display = "none";
  if (allRowEl) allRowEl.style.display = "none";

  // 默认：输入框与按钮都显示（根据页面类型再裁剪）
  if (limitRowEl) limitRowEl.style.display = "";
  if (btnsEl) btnsEl.style.display = "";

  // 默认：两个导出按钮都显示（根据页面类型再裁剪）
  const btnExportThis = $("exportThisCollection");
  const btnExportAll = $("exportAllCollections");
  if (btnExportThis) btnExportThis.style.display = "";
  if (btnExportAll) btnExportAll.style.display = "";

  if (!ctx || ctx.pageType === "other") {
    setHint("请打开知乎收藏夹页（https://www.zhihu.com/collection/<id>）或用户收藏夹列表页后再使用。");
    return;
  }

  if (ctx.pageType === "collection" && ctx.collectionId) {
    cachedCollectionTitle = String(ctx.collectionTitle || "").trim();
    if (!cachedCollectionTitle) cachedCollectionTitle = `#${ctx.collectionId}`;

    setHint(`当前为收藏夹“${cachedCollectionTitle}”页面，正在查询总数…`);
    // 收藏夹页不需要“导出该用户全部收藏夹”按钮
    if (btnExportAll) btnExportAll.style.display = "none";
    // 去掉默认的“请打开知乎页面后点击按钮”提示（此处已经就绪）
    setStatus("");
    $("limitLabel").textContent = "下载条数";
    if (allRowEl) allRowEl.style.display = "";
    if (infoEl) infoEl.style.display = "";

    totalItems = await refreshCollectionTotal(ctx.collectionId);
    cachedCollectionTotal = totalItems;
    if (Number.isFinite(Number(totalItems))) {
      setHint(`当前为收藏夹“${cachedCollectionTitle}”页面，共计 ${Number(totalItems) || 0} 个内容。`);
    } else {
      setHint(`当前为收藏夹“${cachedCollectionTitle}”页面，查询总数失败。`);
    }

    // 绑定即时预估
    const onRangeChange = () => {
      const nInput = $("limit");
      if (nInput) nInput.disabled = getRangeMode() === "all";
      updateEstimate({ totalItems });
    };
    $("rangeLatest")?.addEventListener("change", onRangeChange);
    $("rangeAll")?.addEventListener("change", onRangeChange);
    $("limit")?.addEventListener("input", () => updateEstimate({ totalItems }));

    // 初次渲染
    const nInput = $("limit");
    if (nInput) nInput.disabled = getRangeMode() === "all";
    updateEstimate({ totalItems });
    return;
  }

  if (ctx.pageType === "member_collections") {
    setHint("已识别：当前为用户收藏夹列表页面");
    // 用户要求：在该页面不展示输入框/按钮，只提示进入任一收藏夹再试
    if (limitRowEl) limitRowEl.style.display = "none";
    if (btnsEl) btnsEl.style.display = "none";
    setStatus("请点击进入任一收藏夹后再试");
    return;
  }
})();
