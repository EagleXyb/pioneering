export function getLastTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '') {
    return node as Text;
  }
  if (node.childNodes) {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const found = getLastTextNode(node.childNodes[i]);
      if (found) return found;
    }
  }
  return null;
}
