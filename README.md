# AWS Leads Hub

An AWS-style leads management app built with React, Vite, Tailwind, and localStorage-backed demo data.

## Run

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, usually `http://127.0.0.1:5173`.

## Build

```bash
npm run build
```

## Structure

- `src/main.jsx` - React app, pages, CRUD modals, stream tracking, pipeline, CSV import/export.
- `src/data/crmData.js` - seed users, roles, companies, contacts, leads, tasks, notes, AWS streams.
- `src/styles.css` - Tailwind layers and CRM component styles.
