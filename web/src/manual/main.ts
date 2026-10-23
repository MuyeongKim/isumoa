import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css';
import './manual.css';

// 사용설명서 페이지: 읽고 있는 장을 차례에 표시하고, 인쇄 단추를 단다.

document.getElementById('print')?.addEventListener('click', () => window.print());

// 한글 제목 주소는 링크에서 %EA… 로 바뀌어 있으므로 풀어서 맞춘다
const links = new Map([...document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]')].map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of links.values()) a.removeAttribute('aria-current');
      links.get(entry.target.id)?.setAttribute('aria-current', 'true');
    }
  },
  { rootMargin: '0px 0px -75% 0px' },
);
document.querySelectorAll('.doc h2[id]').forEach((h) => observer.observe(h));
