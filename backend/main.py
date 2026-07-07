"""
GestorDeEstoque – Backend FastAPI (MVP / Fase 1)

Arquivo único contendo:
  • Inicialização do banco SQLite
  • Modelos Pydantic
  • Rotas da API
"""

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="GestorDeEstoque", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Banco de dados SQLite
# ---------------------------------------------------------------------------
DB_PATH = Path(__file__).resolve().parent / "estoque.db"


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db():
    conn = _get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Cria as tabelas caso ainda não existam."""
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS produto (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                nome            TEXT    NOT NULL,
                preco           REAL    NOT NULL,
                quantidade_atual INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS movimentacao (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                produto_id  INTEGER NOT NULL,
                tipo        TEXT    NOT NULL CHECK (tipo IN ('entrada', 'saida')),
                quantidade  INTEGER NOT NULL CHECK (quantidade > 0),
                criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (produto_id) REFERENCES produto(id)
            );
            """
        )
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(movimentacao)").fetchall()
        }
        if "criado_em" not in columns:
            conn.execute("ALTER TABLE movimentacao ADD COLUMN criado_em TEXT")
            conn.execute(
                """
                UPDATE movimentacao
                   SET criado_em = datetime('now', 'localtime')
                 WHERE criado_em IS NULL
                """
            )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------
class ProdutoIn(BaseModel):
    nome: str = Field(..., min_length=1)
    preco: float = Field(..., gt=0)
    quantidade_atual: int = Field(0, ge=0)


class ProdutoUpdate(BaseModel):
    nome: str = Field(..., min_length=1)
    preco: float = Field(..., gt=0)


class ProdutoOut(BaseModel):
    id: int
    nome: str
    preco: float
    quantidade_atual: int


class MovimentacaoIn(BaseModel):
    produto_id: int
    tipo: Literal["entrada", "saida"]
    quantidade: int = Field(..., gt=0)


class MovimentacaoOut(BaseModel):
    id: int
    produto_id: int
    tipo: str
    quantidade: int


class MovimentacaoHistoricoOut(MovimentacaoOut):
    produto_nome: str
    data_hora: str


# ---------------------------------------------------------------------------
# Rotas – Produtos
# ---------------------------------------------------------------------------
@app.get("/produtos", response_model=list[ProdutoOut])
def listar_produtos():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM produto ORDER BY id").fetchall()
        return [dict(r) for r in rows]


@app.post("/produtos", response_model=ProdutoOut, status_code=201)
def cadastrar_produto(produto: ProdutoIn):
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO produto (nome, preco, quantidade_atual) VALUES (?, ?, ?)",
            (produto.nome, produto.preco, produto.quantidade_atual),
        )
        row = conn.execute(
            "SELECT * FROM produto WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return dict(row)


@app.put("/produtos/{produto_id}", response_model=ProdutoOut)
def editar_produto(produto_id: int, produto: ProdutoUpdate):
    with get_db() as conn:
        atual = conn.execute(
            "SELECT * FROM produto WHERE id = ?", (produto_id,)
        ).fetchone()

        if atual is None:
            raise HTTPException(status_code=404, detail="Produto nao encontrado.")

        conn.execute(
            "UPDATE produto SET nome = ?, preco = ? WHERE id = ?",
            (produto.nome, produto.preco, produto_id),
        )
        row = conn.execute(
            "SELECT * FROM produto WHERE id = ?", (produto_id,)
        ).fetchone()
        return dict(row)


@app.delete("/produtos/{produto_id}", status_code=204)
def excluir_produto(produto_id: int):
    with get_db() as conn:
        produto = conn.execute(
            "SELECT * FROM produto WHERE id = ?", (produto_id,)
        ).fetchone()

        if produto is None:
            raise HTTPException(status_code=404, detail="Produto nao encontrado.")

        conn.execute("DELETE FROM movimentacao WHERE produto_id = ?", (produto_id,))
        conn.execute("DELETE FROM produto WHERE id = ?", (produto_id,))
        return None


# ---------------------------------------------------------------------------
# Rotas – Movimentações
# ---------------------------------------------------------------------------
@app.get("/movimentacoes", response_model=list[MovimentacaoHistoricoOut])
def listar_movimentacoes():
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                m.id,
                m.produto_id,
                COALESCE(p.nome, 'Produto removido') AS produto_nome,
                m.tipo,
                m.quantidade,
                COALESCE(m.criado_em, datetime('now', 'localtime')) AS data_hora
            FROM movimentacao m
            LEFT JOIN produto p ON p.id = m.produto_id
            ORDER BY m.id DESC
            """
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/movimentacoes", response_model=MovimentacaoOut, status_code=201)
def registrar_movimentacao(mov: MovimentacaoIn):
    with get_db() as conn:
        # Verifica se o produto existe
        produto = conn.execute(
            "SELECT * FROM produto WHERE id = ?", (mov.produto_id,)
        ).fetchone()

        if produto is None:
            raise HTTPException(status_code=404, detail="Produto não encontrado.")

        nova_qtd: int
        if mov.tipo == "entrada":
            nova_qtd = produto["quantidade_atual"] + mov.quantidade
        else:
            nova_qtd = produto["quantidade_atual"] - mov.quantidade
            if nova_qtd < 0:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Estoque insuficiente. "
                        f"Disponível: {produto['quantidade_atual']}, "
                        f"solicitado: {mov.quantidade}."
                    ),
                )

        # Atualiza estoque e registra movimentação na mesma transação
        conn.execute(
            "UPDATE produto SET quantidade_atual = ? WHERE id = ?",
            (nova_qtd, mov.produto_id),
        )
        cursor = conn.execute(
            """
            INSERT INTO movimentacao (produto_id, tipo, quantidade, criado_em)
            VALUES (?, ?, ?, datetime('now', 'localtime'))
            """,
            (mov.produto_id, mov.tipo, mov.quantidade),
        )
        row = conn.execute(
            "SELECT * FROM movimentacao WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return dict(row)
