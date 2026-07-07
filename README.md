# GestorDeEstoque – MVP (Fase 1)

Sistema de controle de estoque com **FastAPI** (backend) e **React/Vite** (frontend).

## Pré-requisitos

- Python 3.11+
- Node.js 18+

## Como rodar

### 1. Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

O servidor sobe em **http://localhost:8000**.  
A documentação interativa (Swagger) fica em **http://localhost:8000/docs**.

### 2. Frontend (React/Vite)

Em outro terminal:

```bash
cd frontend
npm install
npm run dev
```

O frontend sobe em **http://localhost:5173**.

### 3. Rodar ambos simultaneamente

Abra dois terminais e execute os comandos acima, um em cada terminal.

## Estrutura

```
GestorDeEstoque/
├── backend/
│   ├── main.py              # API FastAPI + SQLite
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Componente principal
│   │   ├── App.css           # Estilização
│   │   ├── api.js            # Chamadas HTTP
│   │   ├── main.jsx          # Entry point
│   │   └── index.css         # Reset global
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── .gitignore
└── README.md
```

## Rotas da API

| Método | Rota              | Descrição                                 |
|--------|--------------------|-------------------------------------------|
| GET    | `/produtos`        | Lista todos os produtos                   |
| POST   | `/produtos`        | Cadastra um novo produto                  |
| POST   | `/movimentacoes`   | Registra entrada/saída (valida estoque)   |
