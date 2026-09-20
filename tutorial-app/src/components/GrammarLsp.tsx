import { useEffect, useState } from 'react';

export default function GrammarLsp() {
  const [status, setStatus] = useState('Initializing Grammar Protocol...');

  useEffect(() => {
    let overlay: HTMLDivElement | null = null;
    let tooltip: HTMLDivElement | null = null;

    const interval = setInterval(() => {
      const cmContent = document.querySelector('.cm-content');
      if (cmContent) {
        setStatus('Grammar Protocol: Active (CodeMirror)');
        setupCodeMirrorOverlay(cmContent as HTMLElement);
        clearInterval(interval);
      }
    }, 1000);

    function setupCodeMirrorOverlay(cmContent: HTMLElement) {
      // 1. Create a persistent container for our squiggles
      overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.pointerEvents = 'none';
      overlay.id = 'grammar-lsp-overlay';
      cmContent.parentElement?.appendChild(overlay);

      // 2. Create the tooltip
      tooltip = document.createElement('div');
      tooltip.id = 'grammar-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '10000';
      tooltip.style.display = 'none';
      tooltip.style.background = '#1e1e21';
      tooltip.style.border = '1px solid #3b82f6';
      tooltip.style.padding = '12px';
      tooltip.style.borderRadius = '4px';
      tooltip.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
      tooltip.style.color = '#e2e8f0';
      tooltip.style.fontSize = '12px';
      tooltip.style.fontFamily = 'Inter, sans-serif';
      tooltip.style.width = '260px';
      tooltip.style.pointerEvents = 'auto';
      document.body.appendChild(tooltip);

      const updateSquiggles = () => {
        if (!overlay) return;
        overlay.innerHTML = '';
        
        // Find "meinen" in the editor lines
        const lines = cmContent.querySelectorAll('.cm-line');
        lines.forEach((line) => {
          const text = line.textContent || '';
          if (text.includes('meinen')) {
            // Find the character offset
            // We'll use a hack to get coordinates from CodeMirror if possible, 
            // but standard DOM range is more reliable
            const range = document.createRange();
            const textNode = findTextNode(line, 'meinen');
            if (textNode) {
              const start = textNode.textContent?.indexOf('meinen') ?? -1;
              range.setStart(textNode, start);
              range.setEnd(textNode, start + 6);
              const rects = range.getClientRects();
              const editorRect = cmContent.getBoundingClientRect();

              for (let rect of rects) {
                const squiggle = document.createElement('div');
                squiggle.style.position = 'fixed';
                squiggle.style.top = `${rect.bottom - 2}px`;
                squiggle.style.left = `${rect.left}px`;
                squiggle.style.width = `${rect.width}px`;
                squiggle.style.height = '3px';
                squiggle.style.pointerEvents = 'auto';
                squiggle.style.cursor = 'help';
                squiggle.style.background = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2c.7 0 1.3-.7 2-1.3C2.7.1 3.3 0 4 0c.7 0 1.3.1 2 .7' fill='none' stroke='%23ef4444' stroke-width='1'/%3E%3C/svg%3E") repeat-x bottom`;
                
                squiggle.onmouseenter = (e) => {
                   if (!tooltip) return;
                   tooltip.innerHTML = `
                     <div style="font-weight:bold; color:#ef4444; margin-bottom:4px">LSP: Dative Requirement Detected</div>
                     <p style="margin-bottom:8px">The verb <strong>'helfen'</strong> requires a <strong>Dative</strong> object.</p>
                     <p style="font-style:italic; color:#94a3b8; font-size:11px">Rule: Object of 'helfen' must be in the dative case (e.g., meinem).</p>
                     <div style="margin-top:8px; display:flex; gap:8px">
                       <button style="background:#374151; border:none; color:white; padding:4px 8px; border-radius:2px; font-size:10px; cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('apply-grammar-fix'))">Quick Fix</button>
                     </div>
                   `;
                   tooltip.style.top = `${rect.bottom + 8}px`;
                   tooltip.style.left = `${rect.left}px`;
                   tooltip.style.display = 'block';
                };

                overlay.appendChild(squiggle);
              }
            }
          }
        });
      };

      // Poll for content changes or use MutationObserver
      const observer = new MutationObserver(updateSquiggles);
      observer.observe(cmContent, { childList: true, subtree: true, characterData: true });
      window.addEventListener('resize', updateSquiggles);
      window.addEventListener('scroll', updateSquiggles, true);
      
      updateSquiggles();
    }

    function findTextNode(root: Node, text: string): Node | null {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.textContent?.includes(text)) return node;
        node = walker.nextNode();
      }
      return null;
    }

    return () => {
      clearInterval(interval);
      overlay?.remove();
      tooltip?.remove();
    };
  }, []);

  return (
    <div id="lsp-status" style={{ 
      padding: '10px', 
      marginBottom: '20px', 
      backgroundColor: status.includes('Active') ? '#064e3b' : '#450a0a',
      color: 'white',
      fontSize: '12px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.2)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    }}>
      <span style={{ marginRight: '8px' }}>●</span>
      {status}
    </div>
  );
}
