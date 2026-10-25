/** Fixed geometry keeps status marks centered independently of font metrics. */
export function statusIcon(kind: 'check' | 'cross' | 'waiting') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('status-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute(
    'd',
    kind === 'check' ? 'M5 12l5 5L19 7' : kind === 'cross' ? 'M6 6l12 12M18 6L6 18' : 'M11 12h2',
  );
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}
