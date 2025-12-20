function htmlToMarkdown(rootEl) {
    if (!rootEl) return "";
    const clone = rootEl.cloneNode(true);
    clone.querySelectorAll("script, style, button, noscript").forEach((n) => n.remove());
  
    function escapeMd(s) {
      return String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
    }
  
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, " ");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
  
      const tag = node.tagName.toLowerCase();
      const childText = Array.from(node.childNodes).map(walk).join("").trim();
  
      if (tag === "br") return "\n";
      if (tag === "p") return childText ? `${childText}\n\n` : "";
      if (tag === "h1") return childText ? `# ${childText}\n\n` : "";
      if (tag === "h2") return childText ? `## ${childText}\n\n` : "";
      if (tag === "h3") return childText ? `### ${childText}\n\n` : "";
      if (tag === "blockquote") return childText ? `> ${childText.replace(/\n/g, "\n> ")}\n\n` : "";
      if (tag === "strong" || tag === "b") return childText ? `**${childText}**` : "";
      if (tag === "em" || tag === "i") return childText ? `*${childText}*` : "";
      if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return childText ? `\`${childText}\`` : "";
      if (tag === "pre") return `\n\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
  
      if (tag === "a") {
        const href = node.getAttribute("href") || "";
        const text = childText || href;
        return href ? `[${escapeMd(text)}](${href})` : text;
      }
  
      if (tag === "img") {
        const src = node.getAttribute("src") || node.getAttribute("data-original") || "";
        return src ? `![](${src})` : "";
      }
  
      if (tag === "ul") {
        const lis = Array.from(node.querySelectorAll(":scope > li"))
          .map((li) => `- ${walk(li).trim()}`)
          .join("\n");
        return lis ? `${lis}\n\n` : "";
      }
  
      if (tag === "ol") {
        const lis = Array.from(node.querySelectorAll(":scope > li"))
          .map((li, i) => `${i + 1}. ${walk(li).trim()}`)
          .join("\n");
        return lis ? `${lis}\n\n` : "";
      }
  
      if (tag === "li") return childText ? `${childText}` : "";
      return childText;
    }
  
    return walk(clone).replace(/\n{3,}/g, "\n\n").trim();
  }
  