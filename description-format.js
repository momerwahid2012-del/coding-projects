(function () {
  const allowedTags = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H2', 'H3', 'H4', 'H5', 'H6',
    'I', 'LI', 'OL', 'P', 'PRE', 'S', 'STRONG', 'U', 'UL'
  ]);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function safeLink(value) {
    try {
      const url = new URL(value, window.location.origin);
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function inlineMarkdown(value) {
    let text = escapeHtml(value);
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '<strong>$1$2</strong>');
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*($|[^*])/g, '$1<em>$2</em>$3');
    text = text.replace(/(^|[^_])_([^_\n]+)_($|[^_])/g, '$1<em>$2</em>$3');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (match, label, href) => {
      const link = safeLink(href);
      return link ? `<a href="${escapeHtml(link)}" rel="noopener noreferrer">${label}</a>` : label;
    });
    return text;
  }

  function markdownToHtml(value) {
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    let listType = '';
    let inCode = false;
    let codeLines = [];

    const closeParagraph = () => {
      if (paragraph.length) {
        output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
        paragraph = [];
      }
    };
    const closeList = () => {
      if (listType) {
        output.push(`</${listType}>`);
        listType = '';
      }
    };

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        closeParagraph();
        closeList();
        if (inCode) {
          output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
          codeLines = [];
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) {
        closeParagraph();
        closeList();
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = Math.min(heading[1].length + 1, 6);
        output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        closeParagraph();
        closeList();
        output.push(`<blockquote><p>${inlineMarkdown(quote[1])}</p></blockquote>`);
        continue;
      }
      const listItem = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
      if (listItem) {
        closeParagraph();
        const nextType = listItem[2] ? 'ol' : 'ul';
        if (listType !== nextType) {
          closeList();
          output.push(`<${nextType}>`);
          listType = nextType;
        }
        output.push(`<li>${inlineMarkdown(listItem[3])}</li>`);
        continue;
      }
      closeList();
      paragraph.push(line);
    }
    closeParagraph();
    closeList();
    if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    return output.join('');
  }

  function sanitize(value) {
    const parsed = new DOMParser().parseFromString(`<body>${String(value ?? '')}</body>`, 'text/html');
    const cleanChildren = parent => {
      for (const node of [...parent.childNodes]) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (!allowedTags.has(node.tagName)) {
          node.replaceWith(...node.childNodes);
          continue;
        }
        const originalHref = node.tagName === 'A' ? node.getAttribute('href') : '';
        for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
        if (node.tagName === 'A') {
          const href = safeLink(originalHref || '');
          if (href) {
            node.setAttribute('href', href);
            node.setAttribute('rel', 'noopener noreferrer');
          } else {
            node.replaceWith(...node.childNodes);
            continue;
          }
        }
        cleanChildren(node);
      }
    };
    cleanChildren(parsed.body);
    return parsed.body.innerHTML;
  }

  function render(value) {
    const text = String(value ?? '');
    return /<\/?[a-z][\s\S]*>/i.test(text) ? sanitize(text) : markdownToHtml(text);
  }

  function plainText(value) {
    const parsed = new DOMParser().parseFromString(render(value), 'text/html');
    for (const block of parsed.body.querySelectorAll('blockquote, br, div, h2, h3, h4, h5, h6, li, p, pre')) {
      block.append(' ');
    }
    return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  window.DescriptionFormat = { markdownToHtml, plainText, render, sanitize };
})();
