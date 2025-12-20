function htmlToMarkdown(rootEl) {
  if (!rootEl) return "";

  const clone = rootEl.cloneNode(true);
  clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());

  const escapeMd = (s) => String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");

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
      if (!src || src.startsWith("data:")) return "";
      return `![](${src})`;
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
