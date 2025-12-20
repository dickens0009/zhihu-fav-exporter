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
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== "GET_CONTEXT") return;
    sendResponse({ ok: true, ctx: parseContext(location.href) });
  });
  