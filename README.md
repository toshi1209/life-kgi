# KGI 分岐

KGI を頂点にしたツリーを、ブラウザで見る。中身はコンテナから `claude --bare -p` を投げる。

フロントは TypeScript（Vite）。API は Python。

## Docker で起動（推奨）

```bash
cd life-kgi
docker compose up --build
```

ブラウザ: http://localhost:8787
