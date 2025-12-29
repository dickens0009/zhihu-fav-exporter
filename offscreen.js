function htmlToMdInOffscreen(html, baseUrl) {
  const container = document.createElement("div");
  container.innerHTML = String(html || "");
  // 关键：offscreen 页面 location.href 是 chrome-extension://...，需要显式传 baseUrl
  return htmlToMarkdown(container, { baseUrl: baseUrl || "" });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type !== "OFFSCREEN_CONVERT_HTML_TO_MD") return;
      const { html, baseUrl } = msg || {};
      const md = htmlToMdInOffscreen(html, baseUrl);
      sendResponse({ ok: true, md });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});


