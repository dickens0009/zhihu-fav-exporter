function parseContext(urlStr) {
    const u = new URL(urlStr);
    const path = u.pathname;
  
    // 1) 用户收藏夹列表页：/people/<token>/collections
    const m1 = path.match(/^\/people\/([^/]+)\/collections/);
    if (m1) return { pageType: "member_collections", urlToken: m1[1], collectionId: null };
  
    // 2) 具体收藏夹页：/collection/<id>
    const m2 = path.match(/^\/collection\/(\d+)/);
  if (m2) return { pageType: "collection", urlToken: null, collectionId: m2[1] };
  
    return { pageType: "other", urlToken: null, collectionId: null };
  }
  
function text(el) {
  return (el?.textContent || "").trim();
}

function getMeta(nameOrProp) {
  return (
    document.querySelector(`meta[name="${nameOrProp}"]`)?.getAttribute("content") ||
    document.querySelector(`meta[property="${nameOrProp}"]`)?.getAttribute("content") ||
    ""
  );
}

function normalizeTitle(s) {
  let t = String(s || "").trim();
  if (!t) return "";
  // 常见标题后缀清理
  t = t.replace(/\s*-\s*知乎\s*$/g, "").trim();
  t = t.replace(/\s*\|\s*知乎\s*$/g, "").trim();
  return t;
}

function pickCollectionTitle() {
  // 1) 页面主标题（优先）
  const h1 =
    document.querySelector(".CollectionDetailPageHeader-title") ||
    document.querySelector(".CollectionHeader-title") ||
    document.querySelector("h1");
  const t1 = normalizeTitle(text(h1));
  if (t1) return t1;

  // 2) meta
  const og = normalizeTitle(getMeta("og:title"));
  if (og) return og;

  // 3) document.title 兜底
  return normalizeTitle(document.title) || "";
}

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== "GET_CONTEXT") return;
  const ctx = parseContext(location.href);
  if (ctx.pageType === "collection") {
    ctx.collectionTitle = pickCollectionTitle();
  }
  sendResponse({ ok: true, ctx });
  });
  