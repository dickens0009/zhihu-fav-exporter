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

function isZhihuArticleUrl() {
  // zhihu.com/p/<id> 或 zhuanlan.zhihu.com/p/<id>
  return /^\/p\/\d+/.test(location.pathname);
}

function pickQuestionTitle() {
  // 回答页标题通常是问题标题
  const h1 = document.querySelector("h1");
  if (h1 && text(h1)) return text(h1);
  const og = getMeta("og:title");
  if (og) return og;
  return document.title?.trim() || "Untitled";
}

function pickArticleTitle() {
  // 专栏文章标题通常是 Post-Title / article 内 h1
  const h1 =
    document.querySelector("h1.Post-Title") ||
    document.querySelector("article h1") ||
    document.querySelector("h1");
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

function pickArticleContentRoot() {
  // 专栏文章正文最常见容器
  const root =
    document.querySelector(".Post-RichTextContainer") ||
    document.querySelector("article .Post-RichTextContainer") ||
    document.querySelector("article .RichText") ||
    document.querySelector(".Post-Main") ||
    document.querySelector("article") ||
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

function removeBlocksByMarkers(container) {
  if (!container) return;

  const markers = [
    "所属专栏",
    "推荐阅读",
    "大家都在搜",
    "换一换",
    "关于作者"
  ];

  const isHeadingTag = (tag) => /^h[1-6]$/.test(tag);

  function closestRemovableBlock(node, marker) {
    let cur = node;
    for (let i = 0; i < 10 && cur && cur !== container; i++) {
      const p = cur.parentElement;
      if (!p || p === container) return cur;

      const tag = (p.tagName || "").toLowerCase();
      if (["section", "aside", "nav", "footer"].includes(tag)) return p;

      const cls = String(p.className || "");
      if (/(recommend|related|footer|search|column|sidebar|aside)/i.test(cls)) return p;

      // 链接很多的块，通常是推荐/趋势/导航类模块
      const linkCount = p.querySelectorAll("a").length;
      if (linkCount >= 6 && text(p).includes(marker)) return p;

      cur = p;
    }
    return cur || node;
  }

  // 先清理“所属专栏”卡片：通常带 /c_ 和“订阅”按钮
  const columnLinks = Array.from(container.querySelectorAll('a[href*="zhuanlan.zhihu.com/c_"]'));
  for (const a of columnLinks) {
    const t = text(a);
    const hasSubBtn = !!a.closest("div")?.querySelector("button");
    if (t.includes("所属专栏") || hasSubBtn) {
      const block = closestRemovableBlock(a, "所属专栏");
      try {
        block.remove();
      } catch {}
    }
  }

  // 通用：根据标题/短文本标记移除模块
  const all = Array.from(container.querySelectorAll("*"));
  const targets = [];
  for (const el of all) {
    const tag = (el.tagName || "").toLowerCase();
    if (!tag) continue;

    const t = text(el);
    if (!t) continue;
    if (t.length > 60) continue; // 避免误伤正文段落

    const hit = markers.find((m) => t === m || t.startsWith(m) || t.includes(`${m} ·`) || t.includes(`${m}·`));
    if (!hit) continue;

    const aria = el.getAttribute?.("aria-label") || "";
    const isLikelyMarker =
      tag === "a" ||
      isHeadingTag(tag) ||
      aria.includes(hit) ||
      (tag === "div" && t === hit);

    if (!isLikelyMarker) continue;
    targets.push({ el, marker: hit });
  }

  // 从深到浅删除，减少“父删子”带来的无效操作
  targets
    .sort((a, b) => {
      const da = a.el.querySelectorAll("*").length;
      const db = b.el.querySelectorAll("*").length;
      return db - da;
    })
    .forEach(({ el, marker }) => {
      if (!el || !el.isConnected) return;
      const block = closestRemovableBlock(el, marker);
      try {
        block.remove();
      } catch {}
    });
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

  // 额外清理：把“所属专栏 / 推荐阅读 / 趋势搜索 / 关于作者”等模块整体移除
  removeBlocksByMarkers(container);
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
    "---"
  ].filter((x) => x !== null && x !== undefined);

  // 关键：确保 front matter 后面一定有换行，避免出现 `---# 标题` 这种粘连
  return lines.join("\n") + "\n";
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
    const title = isZhihuArticleUrl() ? pickArticleTitle() : pickQuestionTitle();
    const author = pickAuthorName();

    let root = isZhihuAnswerUrl()
      ? pickAnswerContentRoot()
      : isZhihuArticleUrl()
        ? pickArticleContentRoot()
        : null;

    // 兜底：如果选择不到，退化到 main/article
    if (!root || text(root).length < 30) {
      root = document.querySelector("main") || document.querySelector("article") || root;
    }

    // 克隆后再清理，避免破坏页面
    const clone = root ? root.cloneNode(true) : null;
    if (clone) cleanNoise(clone);

    const bodyMd = clone ? htmlToMarkdown(clone) : "";
    // 注意：htmlToMarkdown 已经会把正文里的 <img> 转出来。
    // 之前这里又把图片收集后追加到文末，会造成“正文一份 + 文末一份”的重复。

    // 每篇一个文件的文件名：标题 + 作者（统一规则：不追加 answerId / articleId）
    const fileBaseName = `${title}${author ? " - " + author : ""}`;

    const metaLines = [
      `- ${title}`,
      author ? `- 作者：${author}` : null,
      `- 链接：${url}`
    ].filter((x) => x !== null && x !== undefined);

    const md =
      buildFrontMatter({ title, author, url }) +
      "\n" +
      metaLines.join("\n") +
      "\n\n" +
      (bodyMd ? bodyMd + "\n" : "");

    sendResponse({ ok: true, md, title, url, fileBaseName });
  })();

  return true;
});
