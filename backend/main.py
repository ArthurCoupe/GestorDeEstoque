"""
GestorDeEstoque - Backend FastAPI

Fase 4:
  - Banco MySQL local
  - Autenticacao JWT
  - Rotas comerciais protegidas
"""

import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
import pymysql
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from pymysql.cursors import DictCursor

# ---------------------------------------------------------------------------
# Configuracao
# ---------------------------------------------------------------------------
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "gestor_estoque")

JWT_SECRET = os.getenv("JWT_SECRET", "gestor-estoque-dev-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "480"))

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="GestorDeEstoque", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Banco de dados MySQL
# ---------------------------------------------------------------------------
def _connect(database: str | None = MYSQL_DATABASE):
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=database,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )


@contextmanager
def get_db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Cria database, tabelas e usuario admin padrao quando necessario."""
    with _connect(database=None) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DATABASE}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        conn.commit()

    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS usuarios (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(80) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS produto (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nome VARCHAR(255) NOT NULL,
                    preco DECIMAL(10, 2) NOT NULL,
                    quantidade_atual INT NOT NULL DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS movimentacao (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    produto_id INT NOT NULL,
                    tipo ENUM('entrada', 'saida') NOT NULL,
                    quantidade INT NOT NULL,
                    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_movimentacao_produto
                        FOREIGN KEY (produto_id) REFERENCES produto(id)
                        ON DELETE CASCADE,
                    CONSTRAINT chk_movimentacao_quantidade
                        CHECK (quantidade > 0)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute("SELECT COUNT(*) AS total FROM usuarios")
            total_usuarios = cursor.fetchone()["total"]

            if total_usuarios == 0:
                cursor.execute(
                    """
                    INSERT INTO usuarios (username, password_hash)
                    VALUES (%s, %s)
                    """,
                    (ADMIN_USERNAME, pwd_context.hash(ADMIN_PASSWORD)),
                )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


# ---------------------------------------------------------------------------
# Schemas Pydantic
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UsuarioOut(BaseModel):
    id: int
    username: str


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
# Autenticacao
# ---------------------------------------------------------------------------
def criar_token(usuario: dict) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRES_MINUTES)
    payload = {
        "sub": usuario["username"],
        "user_id": usuario["id"],
        "exp": expires_at,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def buscar_usuario(username: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, username, password_hash FROM usuarios WHERE username = %s",
                (username,),
            )
            return cursor.fetchone()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> UsuarioOut:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token invalido ou expirado.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
        username = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError as exc:
        raise credentials_exception from exc

    usuario = buscar_usuario(username)
    if usuario is None:
        raise credentials_exception

    return UsuarioOut(id=usuario["id"], username=usuario["username"])


@app.post("/login", response_model=TokenOut)
def login(credentials: LoginIn):
    usuario = buscar_usuario(credentials.username)

    if usuario is None or not pwd_context.verify(
        credentials.password,
        usuario["password_hash"],
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario ou senha invalidos.",
        )

    return TokenOut(access_token=criar_token(usuario))


# ---------------------------------------------------------------------------
# Rotas - Produtos
# ---------------------------------------------------------------------------
@app.get("/produtos", response_model=list[ProdutoOut])
def listar_produtos(_usuario: UsuarioOut = Depends(get_current_user)):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM produto ORDER BY id")
            return cursor.fetchall()


@app.post("/produtos", response_model=ProdutoOut, status_code=201)
def cadastrar_produto(
    produto: ProdutoIn,
    _usuario: UsuarioOut = Depends(get_current_user),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO produto (nome, preco, quantidade_atual)
                VALUES (%s, %s, %s)
                """,
                (produto.nome, produto.preco, produto.quantidade_atual),
            )
            cursor.execute(
                "SELECT * FROM produto WHERE id = %s",
                (cursor.lastrowid,),
            )
            return cursor.fetchone()


@app.put("/produtos/{produto_id}", response_model=ProdutoOut)
def editar_produto(
    produto_id: int,
    produto: ProdutoUpdate,
    _usuario: UsuarioOut = Depends(get_current_user),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM produto WHERE id = %s", (produto_id,))
            atual = cursor.fetchone()

            if atual is None:
                raise HTTPException(status_code=404, detail="Produto nao encontrado.")

            cursor.execute(
                "UPDATE produto SET nome = %s, preco = %s WHERE id = %s",
                (produto.nome, produto.preco, produto_id),
            )
            cursor.execute("SELECT * FROM produto WHERE id = %s", (produto_id,))
            return cursor.fetchone()


@app.delete("/produtos/{produto_id}", status_code=204)
def excluir_produto(
    produto_id: int,
    _usuario: UsuarioOut = Depends(get_current_user),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM produto WHERE id = %s", (produto_id,))
            produto = cursor.fetchone()

            if produto is None:
                raise HTTPException(status_code=404, detail="Produto nao encontrado.")

            cursor.execute("DELETE FROM movimentacao WHERE produto_id = %s", (produto_id,))
            cursor.execute("DELETE FROM produto WHERE id = %s", (produto_id,))
            return None


# ---------------------------------------------------------------------------
# Rotas - Movimentacoes
# ---------------------------------------------------------------------------
@app.get("/movimentacoes", response_model=list[MovimentacaoHistoricoOut])
def listar_movimentacoes(_usuario: UsuarioOut = Depends(get_current_user)):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    m.id,
                    m.produto_id,
                    COALESCE(p.nome, 'Produto removido') AS produto_nome,
                    m.tipo,
                    m.quantidade,
                    DATE_FORMAT(m.criado_em, '%Y-%m-%d %H:%i:%s') AS data_hora
                FROM movimentacao m
                LEFT JOIN produto p ON p.id = m.produto_id
                ORDER BY m.id DESC
                """
            )
            return cursor.fetchall()


@app.post("/movimentacoes", response_model=MovimentacaoOut, status_code=201)
def registrar_movimentacao(
    mov: MovimentacaoIn,
    _usuario: UsuarioOut = Depends(get_current_user),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM produto WHERE id = %s", (mov.produto_id,))
            produto = cursor.fetchone()

            if produto is None:
                raise HTTPException(status_code=404, detail="Produto nao encontrado.")

            if mov.tipo == "entrada":
                nova_qtd = produto["quantidade_atual"] + mov.quantidade
            else:
                nova_qtd = produto["quantidade_atual"] - mov.quantidade
                if nova_qtd < 0:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Estoque insuficiente. "
                            f"Disponivel: {produto['quantidade_atual']}, "
                            f"solicitado: {mov.quantidade}."
                        ),
                    )

            cursor.execute(
                "UPDATE produto SET quantidade_atual = %s WHERE id = %s",
                (nova_qtd, mov.produto_id),
            )
            cursor.execute(
                """
                INSERT INTO movimentacao (produto_id, tipo, quantidade)
                VALUES (%s, %s, %s)
                """,
                (mov.produto_id, mov.tipo, mov.quantidade),
            )
            cursor.execute(
                "SELECT id, produto_id, tipo, quantidade FROM movimentacao WHERE id = %s",
                (cursor.lastrowid,),
            )
            return cursor.fetchone()
