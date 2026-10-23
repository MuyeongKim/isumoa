import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { manualPage } from './manualPlugin.ts';

// 화면(web) 빌드 설정. 개발 중에는 /api 요청을 서버(3000번 포트)로 넘긴다.
// PDF 처리(pdf.js)에 필요한 한글 글꼴 표(cmaps)·표준 글꼴·WebAssembly 파일을 /pdfjs/ 아래로 함께 내보낸다.
// 사용설명서(docs/사용설명서.md)는 /manual.html 로, 그 그림은 /manual/images/ 로 함께 내보낸다.
const pdfjsAsset = (dir: string) => ({
  src: `../node_modules/pdfjs-dist/${dir}/*`,
  dest: `pdfjs/${dir}`,
  rename: { stripBase: true as const },
});

export default defineConfig({
  // 하위 경로에 올릴 때(예: 바깥 주소 /kmy/edu-cert/)만 VITE_BASE 로 정한다. 기본은 루트
  base: process.env.VITE_BASE ?? '/',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [...['cmaps', 'standard_fonts', 'wasm'].map(pdfjsAsset), { src: ['../docs/images/*.webp', '../docs/images/*.jpg', '!../docs/images/banner.jpg'], dest: 'manual/images', rename: { stripBase: true as const } }],
    }),
    manualPage(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        manual: fileURLToPath(new URL('./manual.html', import.meta.url)),
      },
    },
  },
});
