function pickContentRoot() {
    const selectors = [
      ".RichContent-inner",
      ".Post-RichTextContainer",
      ".RichText",
      "article",
      "main"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 50) return el;
    }
    return null;
  }
  
  function pickTitle() {
    const h1 = document.querySelector("h1")?.textContent?.trim();
    if (h1) return h1;
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim();
    if (og) return og;
    return document.title?.trim() || "Untitled";
  }
  
  function pickAuthor() {
    return (
      document.querySelector(".AuthorInfo-name")?.textContent?.trim() ||
      document.querySelector('[data-za-detail-view-element_name="User"]')?.textContent?.trim() ||
      ""
    );
  }
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg?.type !== "EXTRACT_PAGE") return;
  
      await new Promise((r) => setTimeout(r, 800));
  
      const title = pickTitle();
      const author = pickAuthor();
      const url = location.href;
  
      const root = pickContentRoot();
      const bodyMd = root ? htmlToMarkdown(root) : "";
  
      const imgs = root
        ? Array.from(root.querySelectorAll("img"))
            .map((img) => img.getAttribute("src") || img.getAttribute("data-original") || "")
            .filter(Boolean)
        : [];
      const uniqImgs = Array.from(new Set(imgs));
  
      const imagesMd = uniqImgs.length
        ? `\n\n### 图片（仅链接）\n\n${uniqImgs.map((u) => `![](${u})`).join("\n")}\n`
        : "";
  
      const md =
        `## ${title}\n\n` +
        (author ? `- 作者：${author}\n` : "") +
        `- 链接：${url}\n\n` +
        (bodyMd ? bodyMd + "\n" : "") +
        imagesMd +
        `\n---\n\n`;
  
      sendResponse({ ok: true, md, title, url });
    })();
  
    return true;
  });
  