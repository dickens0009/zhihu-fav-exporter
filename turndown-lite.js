function htmlToMarkdown(rootEl, opts = {}) {
  if (!rootEl) return "";

  const clone = rootEl.cloneNode(true);
  clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());

  const escapeMd = (s) => String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
  const escapeHtmlAttr = (s) => String(s ?? "").replace(/"/g, "&quot;");
  const normalizeEol = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
  const escapeMathDollar = (s) => String(s ?? "").replace(/\$/g, "\\$");
  const parsePositiveInt = (v) => {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
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
  const baseHref =
    (opts && typeof opts.baseUrl === "string" && opts.baseUrl.trim())
      ? opts.baseUrl.trim()
      : (typeof location !== "undefined" ? location.href : "");

  const baseProtocol = (() => {
    try {
      return baseHref ? new URL(baseHref).protocol : "https:";
    } catch {
      return "https:";
    }
  })();

  const toAbsUrl = (u) => {
    const src = String(u || "").trim();
    if (!src) return "";
    if (src.startsWith("data:")) return "";
    if (src.startsWith("http://") || src.startsWith("https://")) return src;
    if (src.startsWith("//")) return `${baseProtocol}${src}`;
    try {
      return new URL(src, baseHref || undefined).href;
    } catch {
      return src;
    }
  };

  // 图片最大展示宽度：默认 800；若图片原宽小于该值，则按原尺寸展示
  const maxImageWidth = (() => {
    const n = Number(opts?.maxImageWidth);
    return Number.isFinite(n) && n > 0 ? n : 800;
  })();

  const imgHtml = (src, { alt, width, height } = {}) => {
    const attrs = [];
    attrs.push(`src="${escapeHtmlAttr(src)}"`);
    if (alt) attrs.push(`alt="${escapeHtmlAttr(alt)}"`);
    if (width) attrs.push(`width="${parsePositiveInt(width)}"`);
    if (height) attrs.push(`height="${parsePositiveInt(height)}"`);
    return `<img ${attrs.join(" ")}>`;
  };

  const extractTexFromImg = (imgEl) => {
    if (!imgEl) return "";
    const alt = (imgEl.getAttribute?.("alt") || "").trim();
    // 有些站点会把 TeX 放在 alt 里
    if (alt && /\\[a-zA-Z]+/.test(alt)) return alt;

    const src =
      imgEl.getAttribute?.("data-original") ||
      imgEl.getAttribute?.("data-actualsrc") ||
      imgEl.getAttribute?.("src") ||
      "";
    if (!src) return "";
    try {
      const abs = toAbsUrl(src);
      const u = new URL(abs, location.href);
      // 兼容：/equation?tex=... 这类“公式图片”链接
      const tex = u.searchParams.get("tex") || "";
      return tex ? decodeURIComponent(tex) : "";
    } catch {
      return "";
    }
  };

  const looksLikeOnlyMathInP = (mathEl) => {
    const p = mathEl?.parentElement;
    if (!p || p.tagName?.toLowerCase() !== "p") return false;

    // 只要段落里除了空白文本/换行，剩下都是“公式类元素”，就视为块公式
    const isMathNode = (n) => {
      if (!n) return false;
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n;
        const tag = el.tagName?.toLowerCase();
        if (tag === "br") return true;
        if (el.hasAttribute?.("data-tex")) return true;
        const cls = String(el.className || "");
        if (/\bztext-math\b/.test(cls)) return true;
        if (/\bkatex\b/.test(cls)) return true;
        if (tag === "annotation" && /tex/i.test(el.getAttribute?.("encoding") || "")) return true;
        if (tag === "img" && (/\bztext-math\b/.test(cls) || String(el.getAttribute?.("src") || "").includes("equation?tex="))) {
          return true;
        }
      }
      return false;
    };

    for (const n of Array.from(p.childNodes || [])) {
      if (n.nodeType === Node.TEXT_NODE) {
        if ((n.textContent || "").trim() === "") continue;
        return false;
      }
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (isMathNode(n)) continue;
        return false;
      }
    }

    return true;
  };

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();

    // 数学公式（知乎常见：span.ztext-math[data-tex]；以及 KaTeX/MathJax 的 annotation）
    {
      const cls = String(node.className || "");
      const dataTex = node.getAttribute?.("data-tex");
      const isZhihuMath = dataTex && /\bztext-math\b/.test(cls);
      const isMathContainer =
        !!dataTex ||
        /\bztext-math\b/.test(cls) ||
        /\bkatex\b/.test(cls) ||
        tag === "annotation" ||
        tag === "img";
      if (isMathContainer) {
        let tex = "";
        if (dataTex) {
          tex = dataTex;
        } else if (tag === "annotation" && /tex/i.test(node.getAttribute?.("encoding") || "")) {
          tex = node.textContent || "";
        } else if (/\bkatex\b/.test(cls)) {
          const ann = node.querySelector?.('annotation[encoding*="tex" i]');
          tex = ann?.textContent || "";
        } else if (tag === "img") {
          tex = extractTexFromImg(node);
        } else if (/\bztext-math\b/.test(cls)) {
          // 有些结构 ztext-math 自身没有 data-tex，但内部 annotation 有
          const ann = node.querySelector?.('annotation[encoding*="tex" i]');
          tex = ann?.textContent || "";
        }

        tex = normalizeEol(tex).trim();
        if (tex) {
          // 规范：行内用 $...$，行间用 $$...$$
          // 尽量判断“块公式”：显式标记/独占段落
          const displayAttr = (node.getAttribute?.("data-display") || "").toLowerCase();
          const isBlock =
            displayAttr === "block" ||
            tag === "div" ||
            looksLikeOnlyMathInP(node) ||
            // 兜底：知乎的块公式很多会是 ztext-math 且周围没有文字
            (isZhihuMath && (node.closest?.("p") ? looksLikeOnlyMathInP(node) : false));

          if (isBlock) {
            const body = `$$\n${escapeMathDollar(tex)}\n$$`;
            // 在段落内由 <p> 负责补空行；否则这里补上，避免粘连上下文
            return node.parentElement?.tagName?.toLowerCase() === "p" ? body : `\n\n${body}\n\n`;
          }

          const inline = escapeMathDollar(tex).replace(/\s*\n\s*/g, " ");
          return `$${inline}$`;
        }
      }
    }

    // 保留代码块
    if (tag === "pre") {
      const code = node.querySelector("code");
      const txt = (code ? code.textContent : node.textContent) || "";
      const lang = pickCodeLang(code);
      return wrapFencedCodeBlock(txt, lang);
    }

    // 表格：Obsidian 支持 Markdown 内嵌 HTML。这里原样保留 HTML，避免“表格转 md”带来的对齐/合并单元格等问题。
    // 注意：返回时前后补空行，避免与相邻文本粘连导致渲染异常。
    if (tag === "table") {
      const html = node.outerHTML || "";
      return html ? `\n\n${html}\n\n` : "";
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
      const trimmed = t.trim();
      if (!trimmed) return "";
      // 若段落里包含块公式（$$...$$），不要把换行压扁
      if (/^\$\$\s*[\s\S]*\s*\$\$$/.test(trimmed) || trimmed.includes("\n$$\n") || trimmed.startsWith("$$\n")) {
        return `${trimmed}\n\n`;
      }

      // 兜底：如果段落中包含表格 HTML，不要把换行全部去掉（否则可能把 <table> 挤成一行影响渲染）
      if (/<table[\s>]/i.test(trimmed) || /<\/table>/i.test(trimmed)) {
        return `${trimmed}\n\n`;
      }

      // 链接卡片（LinkCard）在知乎里通常是块级元素：需要保留/强制换行，避免与后续正文粘连
      // 示例：<a class="LinkCard" data-draft-type="link-card" ...>...</a>
      if (node.querySelector?.('a.LinkCard, a[data-draft-type="link-card"]')) {
        return `${trimmed}\n\n`;
      }
      return trimmed.replace(/\n/g, "").trim() ? `${trimmed.replace(/\n/g, "")}\n\n` : "";
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

      // 链接卡片：用标题作为文本，并在末尾追加空行，避免与后续文本粘连
      const isLinkCard =
        node.classList?.contains("LinkCard") ||
        node.getAttribute("data-draft-type") === "link-card" ||
        node.getAttribute("data-draft-type") === "link_card";
      const cardTitle = isLinkCard
        ? trimSpaces(node.querySelector?.(".LinkCard-title")?.textContent || "").trim()
        : "";

      const t = childText.trim();
      const text = cardTitle || t || href;
      if (!href) return text;
      // 知乎相对链接补全
      const abs = href.startsWith("http") ? href : new URL(href, location.href).href;
      const md = `[${escapeMd(text)}](${abs})`;
      return isLinkCard ? `${md}\n\n` : md;
    }

    if (tag === "img") {
      const src =
        node.getAttribute("data-original") ||
        node.getAttribute("data-actualsrc") ||
        node.getAttribute("src") ||
        "";
      const abs = toAbsUrl(src);
      if (!abs) return "";

      const alt = (node.getAttribute?.("alt") || "").trim();

      // 知乎图片常见：data-rawwidth/data-rawheight；也可能直接有 width/height
      const rawW =
        parsePositiveInt(node.getAttribute?.("data-rawwidth")) ||
        parsePositiveInt(node.getAttribute?.("data-raw-width")) ||
        parsePositiveInt(node.getAttribute?.("width"));
      const rawH =
        parsePositiveInt(node.getAttribute?.("data-rawheight")) ||
        parsePositiveInt(node.getAttribute?.("data-raw-height")) ||
        parsePositiveInt(node.getAttribute?.("height"));

      // 默认行为：大图限制最大宽度；小图按原尺寸展示
      let outW = 0;
      let outH = 0;
      if (rawW) {
        outW = rawW <= maxImageWidth ? rawW : maxImageWidth;
        if (rawH) {
          outH = rawW <= maxImageWidth ? rawH : Math.round((rawH * maxImageWidth) / rawW);
        }
      } else {
        // 拿不到原图宽度时，保持旧行为：兜底 width=800
        outW = maxImageWidth;
      }

      // 这里直接输出 HTML，Markdown 渲染器一般会保留 HTML 标签
      return imgHtml(abs, { alt, width: outW, height: outH });
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
