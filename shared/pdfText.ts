export interface PdfTextItem {
  str: string;
  hasEOL: boolean;
  transform: number[];
  width: number;
  height: number;
}

/** PDF의 그리기 명령 순서와 무관하게 위→아래, 왼쪽→오른쪽으로 읽는다. */
export function joinPdfTextItems(items: readonly PdfTextItem[]): string {
  const rows: PdfTextItem[][] = [];
  for (const item of [...items].filter(i => i.str.trim() !== '').sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    const row = rows.find(r => Math.abs(r[0].transform[5] - item.transform[5]) < Math.max(Math.min(r[0].height, item.height), 1) * 0.5);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.sort((a, b) => b[0].transform[5] - a[0].transform[5]).map(row => {
    let text = '';
    let previous: PdfTextItem | null = null;
    for (const item of row.sort((a, b) => a.transform[4] - b.transform[4])) {
      if (previous) {
        const gap = item.transform[4] - (previous.transform[4] + previous.width);
        const size = Math.max(previous.height, 1);
        if (gap > size * 0.8) text += '  ';
        else if (gap > size * 0.15 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
      }
      text += item.str;
      previous = item;
    }
    return text.trim();
  }).join('\n').normalize('NFC');
}
