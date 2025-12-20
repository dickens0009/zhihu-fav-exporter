function htmlToMarkdown(rootEl) {
  if (!rootEl) return "";

  const clone = rootEl.cloneNode(true);
  clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());

  const escapeMd = (s) => String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
  const escapeHtmlAttr = (s) => String(s ?? "").replace(/"/g, "&quot;");
  const normalizeEol = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
  const longestRun = (s, ch) => {
    const str = String(s ?? "");
    let max = 0;
    let cur = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === ch) {
        cur++;
        if (cur > max) max = cur;
      } else {
        cur = 0;
      }
    }
    return max;
  };
  const wrapFencedCodeBlock = (codeText, lang) => {
    // 关键修复：代码内容里如果包含 ```，固定三反引号会把 fenced code 提前截断。
    // 这里动态选用“更长的 fence”，保证永远不会冲突。
    const txt = normalizeEol(codeText);
    const trimmed = txt.replace(/^\n+/, "").replace(/\n+$/, "");
    const maxTicks = longestRun(trimmed, "`");
    const fence = "`".repeat(Math.max(3, maxTicks + 1));
    const langPart = lang ? String(lang).trim() : "";
    return `\n${fence}${langPart ? langPart : ""}\n${trimmed}\n${fence}\n\n`;
  };
  const wrapInlineCode = (inlineText) => {
    const txt = normalizeEol(inlineText).trim();
    if (!txt) return "";
    const maxTicks = longestRun(txt, "`");
    const fence = "`".repeat(Math.max(1, maxTicks + 1));
    // 若内容首尾就是反引号，按 CommonMark 建议在内容两侧加空格
    if (txt.startsWith("`") || txt.endsWith("`")) {
      return `${fence} ${txt} ${fence}`;
    }
    return `${fence}${txt}${fence}`;
  };
  const pickCodeLang = (codeEl) => {
    if (!codeEl) return "";
    // 常见：<code class="language-text"> / language-js / lang-python 等
    const cls = String(codeEl.getAttribute?.("class") || codeEl.className || "");
    const m = cls.match(/\b(?:language|lang)-([a-zA-Z0-9_+-]+)\b/);
    const lang = (m && m[1]) ? m[1].toLowerCase() : "";
    // text/plain 这类不强求标注
    if (lang === "text" || lang === "plain") return "";
    return lang;
  };
  const trimSpaces = (s) => String(s ?? "").replace(/^[ \t]+|[ \t]+$/g, "");
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
      const lang = pickCodeLang(code);
      return wrapFencedCodeBlock(txt, lang);
    }

    // 行内 code
    if (tag === "code") {
      const txt = node.textContent || "";
      if (node.parentElement?.tagName?.toLowerCase() === "pre") return ""; // pre 已处理
      return wrapInlineCode(txt);
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

    // 重要：不要在这里对 children 做 .trim() —— 会把代码块等子节点刻意输出的换行裁掉，
    // 从而导致出现 “```紧贴正文” 的坏 Markdown（例如：```考虑到...）。
    const children = Array.from(node.childNodes).map(walk).join("");
    const childText = children; // 默认保留换行，仅在特定标签里按需 trim

    if (tag === "br") return "\n";
    if (tag === "p") {
      const t = trimSpaces(childText);
      return t.replace(/\n/g, "").trim() ? `${t}\n\n` : "";
    }
    if (tag === "h1") {
      const t = childText.trim();
      return t ? `# ${t}\n\n` : "";
    }
    if (tag === "h2") {
      const t = childText.trim();
      return t ? `## ${t}\n\n` : "";
    }
    if (tag === "h3") {
      const t = childText.trim();
      return t ? `### ${t}\n\n` : "";
    }
    if (tag === "h4") {
      const t = childText.trim();
      return t ? `#### ${t}\n\n` : "";
    }
    if (tag === "blockquote") {
      const t = trimSpaces(childText);
      return t.replace(/\n/g, "").trim() ? `> ${t.replace(/\n/g, "\n> ")}\n\n` : "";
    }

    if (tag === "strong" || tag === "b") {
      const t = childText.trim();
      return t ? `**${t}**` : "";
    }
    if (tag === "em" || tag === "i") {
      const t = childText.trim();
      return t ? `*${t}*` : "";
    }

    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      const t = childText.trim();
      const text = t || href;
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
