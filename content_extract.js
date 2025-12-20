function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function isZhihuAnswerUrl() {
  return /^\/question\/\d+\/answer\/\d+/.test(location.pathname);
}

function pickQuestionTitle() {
  // 回答页标题通常是问题标题
  const h1 = document.querySelector("h1");
  if (h1 && text(h1)) return text(h1);
  const og = getMeta("og:title");
  if (og) return og;
  return document.title?.trim() || "Untitled";
}

function pickAuthorName() {
  // 常见作者名位置
  const a1 = document.querySelector(".AuthorInfo-name");
  if (a1 && text(a1)) return text(a1);

  // 某些结构会是链接
  const a2 = document.querySelector('a.AuthorInfo-name');
  if (a2 && text(a2)) return text(a2);

  return "";
}

function pickAnswerContentRoot() {
  // 回答正文最常见容器
  const root =
    document.querySelector(".AnswerItem .RichContent-inner") ||
    document.querySelector(".RichContent-inner") ||
    document.querySelector(".AnswerItem") ||
    null;
  return root;
}

async function expandAllIfNeeded() {
  // 尝试点击“展开阅读全文 / 显示全部”
  const candidates = [
    'button.ContentItem-expandButton',
    'button.RichContent-expandButton',
    'button[aria-label*="展开"]',
    'button:has(span:contains("展开"))' // 这个选择器在部分浏览器不支持，下面兜底
  ];

  // 兜底：找文本包含“展开”的 button
  const buttons = Array.from(document.querySelectorAll("button")).filter((b) => {
    const t = text(b);
    return t.includes("展开") || t.includes("阅读全文") || t.includes("显示全部");
  });

  // 先点明确 class 的
  for (const sel of candidates.slice(0, 3)) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      btn.click();
      await sleep(500);
    }
  }

  // 再点文本匹配的（可能会误点，控制次数）
  for (const b of buttons.slice(0, 3)) {
    try {
      b.click();
      await sleep(400);
    } catch {}
  }
}

function cleanNoise(container) {
  if (!container) return;

  // 移除明显的互动区/按钮/脚注等（尽量不伤正文）
  const removeSelectors = [
    "button",
    "noscript",
    "script",
    "style",
    ".RichContent-actions",
    ".ContentItem-actions",
    ".ContentItem-time",
    ".AnswerItem-authorInfo",
    ".CommentList",
    ".Comments-container",
    ".MoreAnswers",
    ".RelatedReadings",
    ".AnswerItem-meta",
    ".AnswerItem-selfMenu",
    ".ZVideoItem",
    ".Reward",
    ".PCRewardPanel",
    ".RichContent-copyright"
  ];

  container.querySelectorAll(removeSelectors.join(",")).forEach((n) => n.remove());

  // 去掉“展开阅读全文”残留
  container.querySelectorAll(".ContentItem-expandButton, .RichContent-expandButton").forEach((n) => n.remove());
}

function collectImages(root) {
  if (!root) return [];
  const urls = Array.from(root.querySelectorAll("img"))
    .map((img) => img.getAttribute("data-original") || img.getAttribute("data-actualsrc") || img.getAttribute("src") || "")
    .filter(Boolean)
    // 过滤掉 base64/表情等
    .filter((u) => !u.startsWith("data:"));

  return Array.from(new Set(urls));
}

function buildFrontMatter({ title, author, url }) {
  // Obsidian 友好：YAML front matter
  const esc = (s) => String(s || "").replace(/"/g, '\\"');
  const lines = [
    "---",
    `title: "${esc(title)}"`,
    author ? `author: "${esc(author)}"` : null,
    `source: "${esc(url)}"`,
    `exported_at: "${new Date().toISOString()}"`,
    "---",
    ""
  ].filter(Boolean);
  return lines.join("\n");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type !== "EXTRACT_PAGE") return;

    // 等首屏渲染
    await sleep(800);

    // 如果是回答页：尽量展开全文
    if (isZhihuAnswerUrl()) {
      await expandAllIfNeeded();
      await sleep(600);
    }

    const url = location.href;
    const title = pickQuestionTitle();
    const author = pickAuthorName();

    let root = pickAnswerContentRoot();

    // 兜底：如果选择不到，退化到 main/article
    if (!root || text(root).length < 30) {
      root = document.querySelector("main") || document.querySelector("article") || root;
    }

    // 克隆后再清理，避免破坏页面
    const clone = root ? root.cloneNode(true) : null;
    if (clone) cleanNoise(clone);

    const bodyMd = clone ? htmlToMarkdown(clone) : "";
    const imgs = clone ? collectImages(clone) : [];

    const imagesMd = imgs.length
      ? `\n\n## 图片（仅链接）\n\n${imgs.map((u) => `![](${u})`).join("\n")}\n`
      : "";

    // 每篇一个文件的文件名：标题 + 作者（统一规则：不追加 answerId / articleId）
    const fileBaseName = `${title}${author ? " - " + author : ""}`;

    const md =
      buildFrontMatter({ title, author, url }) +
      `# ${title}\n\n` +
      (author ? `- 作者：${author}\n` : "") +
      `- 链接：${url}\n\n` +
      (bodyMd ? bodyMd + "\n" : "") +
      imagesMd;

    sendResponse({ ok: true, md, title, url, fileBaseName });
  })();

  return true;
});
