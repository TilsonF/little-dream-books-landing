# Little Dream Books — Landing Page

Landing page dinámica para la serie de libros **Isabella** de Tilson Fernandez.  
Construida con [Astro](https://astro.build), desplegada en GitHub Pages, con sincronización automática diaria de datos de Amazon.

---

## 🚀 Setup en GitHub (una vez)

### 1. Crear el repositorio

```bash
# Desde la carpeta landing/
git init
git add .
git commit -m "feat: initial landing page"
```

Ve a [github.com/new](https://github.com/new) y crea un repositorio **privado** llamado `little-dream-books-landing`.  
Luego conecta y sube:

```bash
git remote add origin https://github.com/TU_USUARIO/little-dream-books-landing.git
git branch -M main
git push -u origin main
```

### 2. Activar GitHub Pages

1. Ve a tu repositorio → **Settings** → **Pages**
2. En **Source** selecciona `GitHub Actions`
3. Guarda

### 3. Dar permisos al workflow

1. Ve a **Settings** → **Actions** → **General**
2. En **Workflow permissions** selecciona:  
   ✅ `Read and write permissions`  
   ✅ `Allow GitHub Actions to create and approve pull requests`
3. Guarda

Listo. El primer deploy ocurrirá automáticamente en el primer push.

---

## 📚 Agregar un libro nuevo

Cuando publiques un nuevo libro en Amazon, edita **solo este archivo**:

📄 [`src/data/asins.json`](src/data/asins.json)

Agrega una nueva entrada al array `books`:

```json
{
  "id": "nombre-slug-del-libro",
  "tag": "Nuevo",
  "tagColor": "chip-mint",
  "isNew": true,
  "primaryAsin": "ASIN_PASTA_BLANDA_EN",
  "editions": {
    "en": {
      "paperback": "ASIN_PASTA_BLANDA_EN",
      "ebook": "ASIN_EBOOK_EN",
      "hardcover": "ASIN_TAPA_DURA_EN"
    },
    "es": {
      "paperback": "ASIN_PASTA_BLANDA_ES",
      "ebook": "ASIN_EBOOK_ES",
      "hardcover": ""
    }
  }
}
```

Luego haz commit y push:

```bash
git add src/data/asins.json
git commit -m "feat: add new book [titulo]"
git push
```

GitHub Actions detecta el cambio, descarga los datos de Amazon y despliega en ~2 minutos.

---

## ⚙️ Cómo funciona la automatización

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions                           │
│                                                             │
│  Cron diario 8AM UTC  ──┐                                   │
│  Push a asins.json  ────┤──▶  fetch-books.mjs               │
│  Trigger manual     ──┘         │                           │
│                           Descarga datos                    │
│                           de Amazon (/dp/ASIN)              │
│                                  │                          │
│                           src/data/books.json               │
│                                  │                          │
│                           npm run build                     │
│                                  │                          │
│                           GitHub Pages 🚀                   │
└─────────────────────────────────────────────────────────────┘
```

| Archivo | Quién lo edita |
|---|---|
| `src/data/asins.json` | **Tú** — cuando publicas un libro nuevo |
| `src/data/books.json` | **GitHub Actions** — automático cada día |
| `src/components/` | Antigravity / desarrollador |

---

## 🛡️ Resiliencia ante bloqueos de Amazon

El scraper está diseñado para sobrevivir bloqueos temporales de Amazon:

- Si Amazon bloquea la petición → el site se reconstruye con los **datos del día anterior**
- Cada ASIN tiene un delay aleatorio de 3-7 segundos entre requests
- Si **todos** los requests fallan → el job falla silenciosamente y no sobreescribe `books.json`
- Históricamente, Amazon no bloquea 1-5 requests por día con headers normales

---

## 🖥️ Desarrollo local

```bash
npm install
npm run dev          # http://localhost:4321

# Actualizar datos de Amazon manualmente:
node scripts/fetch-books.mjs
```

---

## 📁 Estructura del proyecto

```
landing/
├── .github/
│   └── workflows/
│       └── sync-books.yml      # GitHub Actions workflow
├── scripts/
│   └── fetch-books.mjs         # Scraper de Amazon
├── src/
│   ├── components/
│   │   ├── Navbar.astro
│   │   ├── Hero.astro
│   │   ├── BooksGrid.astro     # Lee books.json automáticamente
│   │   ├── AboutIsabella.astro
│   │   ├── Benefits.astro
│   │   ├── Educational.astro
│   │   ├── CTA.astro
│   │   └── Footer.astro
│   ├── data/
│   │   ├── asins.json          # ← EDITAR AQUÍ para agregar libros
│   │   └── books.json          # Auto-generado por GitHub Actions
│   ├── layouts/
│   │   └── Layout.astro
│   └── pages/
│       └── index.astro
└── public/
    └── favicon.svg
```
