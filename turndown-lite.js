function htmlToMarkdown(rootEl) {
  if (!rootEl) return "";

  const clone = rootEl.cloneNode(true);
  clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());

  const escapeMd = (s) => String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
  const escapeHtmlAttr = (s) => String(s ?? "").replace(/"/g, "&quot;");
  const toAbsUrl = (u) => {
    const src = String(u || "").trim();
    if (!src) return "";
    if (src.startsWith("data:")) return "";
    if (src.startsWith("http://") || src.startsWith("https://")) return src;
    if (src.startsWith("//")) return `${location.protocol}${src}`;
    try {
      return new URL(src, location.href).href;
    } catch {
      return src;
    }
  };
  const imgHtml = (src) => `<img src="${escapeHtmlAttr(src)}" width="800">`;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();

    // 保留代码块
    if (tag === "pre") {
      const code = node.querySelector("code");
      const txt = (code ? code.textContent : node.textContent) || "";
      return `\n\`\`\`\n${txt.trim()}\n\`\`\`\n\n`;
    }

    // 行内 code
    if (tag === "code") {
      const txt = (node.textContent || "").trim();
      if (!txt) return "";
      if (node.parentElement?.tagName?.toLowerCase() === "pre") return ""; // pre 已处理
      return `\`${txt}\``;
    }

    // figure/figcaption：保证“图在上，标题在下”（知乎很常见）
    if (tag === "figure") {
      const imgs = Array.from(node.querySelectorAll(":scope img"))
        .map((img) => walk(img).trim())
        .filter(Boolean);

      const capNode = node.querySelector(":scope figcaption");
      const capText = capNode
        ? Array.from(capNode.childNodes).map(walk).join("").trim()
        : "";

      const parts = [];
      if (imgs.length) parts.push(imgs.join("\n\n"));
      if (capText) parts.push(capText);
      return parts.length ? `\n\n${parts.join("\n\n")}\n\n` : "";
    }

    if (tag === "figcaption") {
      // 单独出现时也当作块级文本，确保换行
      const capText = Array.from(node.childNodes).map(walk).join("").trim();
      return capText ? `\n\n${capText}\n\n` : "";
    }

    const children = Array.from(node.childNodes).map(walk).join("");
    const childText = children.trim();

    if (tag === "br") return "\n";
    if (tag === "p") return childText ? `${childText}\n\n` : "";
    if (tag === "h1") return childText ? `# ${childText}\n\n` : "";
    if (tag === "h2") return childText ? `## ${childText}\n\n` : "";
    if (tag === "h3") return childText ? `### ${childText}\n\n` : "";
    if (tag === "h4") return childText ? `#### ${childText}\n\n` : "";
    if (tag === "blockquote") return childText ? `> ${childText.replace(/\n/g, "\n> ")}\n\n` : "";

    if (tag === "strong" || tag === "b") return childText ? `**${childText}**` : "";
    if (tag === "em" || tag === "i") return childText ? `*${childText}*` : "";

    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      const text = childText || href;
      if (!href) return text;
      // 知乎相对链接补全
      const abs = href.startsWith("http") ? href : new URL(href, location.href).href;
      return `[${escapeMd(text)}](${abs})`;
    }

    if (tag === "img") {
      const src =
        node.getAttribute("data-original") ||
        node.getAttribute("data-actualsrc") ||
        node.getAttribute("src") ||
        "";
      const abs = toAbsUrl(src);
      if (!abs) return "";
      // 这里直接输出 HTML，满足“width=800”的要求；Markdown 渲染器一般会保留 HTML 标签
      return imgHtml(abs);
    }

    if (tag === "ul") {
      const lis = Array.from(node.querySelectorAll(":scope > li"))
        .map((li) => `- ${walk(li).trim()}`)
        .filter(Boolean)
        .join("\n");
      return lis ? `${lis}\n\n` : "";
    }

    if (tag === "ol") {
      const lis = Array.from(node.querySelectorAll(":scope > li"))
        .map((li, i) => `${i + 1}. ${walk(li).trim()}`)
        .filter(Boolean)
        .join("\n");
      return lis ? `${lis}\n\n` : "";
    }

    if (tag === "li") return childText || "";

    // 默认：原样输出子内容
    return childText;
  }

  return walk(clone)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
