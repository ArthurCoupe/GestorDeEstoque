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
                    password_hash VARCHAR(255) NOT NULL,
                    role ENUM('admin', 'operador') NOT NULL DEFAULT 'operador'
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute("SHOW COLUMNS FROM usuarios")
            usuario_columns = {column["Field"] for column in cursor.fetchall()}

            if "role" not in usuario_columns:
                cursor.execute(
                    "ALTER TABLE usuarios "
                    "ADD COLUMN role ENUM('admin', 'operador') "
                    "NOT NULL DEFAULT 'operador'"
                )

            cursor.execute(
                "UPDATE usuarios SET role = 'admin' WHERE username = %s",
                (ADMIN_USERNAME,),
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS produto (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nome VARCHAR(255) NOT NULL,
                    preco DECIMAL(10, 2) NOT NULL,
                    quantidade_atual INT NOT NULL DEFAULT 0,
                    estoque_minimo INT NOT NULL DEFAULT 5
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute("SHOW COLUMNS FROM produto")
            produto_columns = {column["Field"] for column in cursor.fetchall()}

            if "preco" not in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "ADD COLUMN preco DECIMAL(10, 2) NOT NULL DEFAULT 0"
                )

                if "preco_venda" in produto_columns:
                    cursor.execute("UPDATE produto SET preco = preco_venda")

            if "preco_custo" in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "MODIFY preco_custo DOUBLE NOT NULL DEFAULT 0"
                )

            if "preco_venda" in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "MODIFY preco_venda DOUBLE NOT NULL DEFAULT 0"
                )

            if "estoque_minimo" not in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "ADD COLUMN estoque_minimo INT NOT NULL DEFAULT 5"
                )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS movimentacao (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    produto_id INT NOT NULL,
                    usuario_id INT NULL,
                    tipo ENUM('entrada', 'saida') NOT NULL,
                    quantidade INT NOT NULL,
                    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_movimentacao_produto
                        FOREIGN KEY (produto_id) REFERENCES produto(id)
                        ON DELETE CASCADE,
                    CONSTRAINT fk_movimentacao_usuario
                        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
                        ON DELETE SET NULL,
                    CONSTRAINT chk_movimentacao_quantidade
                        CHECK (quantidade > 0)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute("SHOW COLUMNS FROM movimentacao")
            movimentacao_columns = {column["Field"] for column in cursor.fetchall()}

            if "criado_em" not in movimentacao_columns:
                cursor.execute(
                    "ALTER TABLE movimentacao "
                    "ADD COLUMN criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                )

                if "data_hora" in movimentacao_columns:
                    cursor.execute("UPDATE movimentacao SET criado_em = data_hora")

            if "valor_total" in movimentacao_columns:
                cursor.execute(
                    "ALTER TABLE movimentacao "
                    "MODIFY valor_total DOUBLE NOT NULL DEFAULT 0"
                )

            if "usuario_id" not in movimentacao_columns:
                cursor.execute(
                    "ALTER TABLE movimentacao "
                    "ADD COLUMN usuario_id INT NULL"
                )

            cursor.execute(
                """
                SELECT COUNT(*) AS total
                FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'movimentacao'
                    AND CONSTRAINT_NAME = 'fk_movimentacao_usuario'
                """
            )
            if cursor.fetchone()["total"] == 0:
                cursor.execute(
                    """
                    ALTER TABLE movimentacao
                    ADD CONSTRAINT fk_movimentacao_usuario
                        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
                        ON DELETE SET NULL
                    """
                )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS alertas (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    produto_id INT NOT NULL,
                    mensagem VARCHAR(500) NOT NULL,
                    lido_boolean BOOLEAN NOT NULL DEFAULT FALSE,
                    data_hora DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_alerta_produto
                        FOREIGN KEY (produto_id) REFERENCES produto(id)
                        ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            cursor.execute("SELECT COUNT(*) AS total FROM usuarios")
            total_usuarios = cursor.fetchone()["total"]

            if total_usuarios == 0:
                cursor.execute(
                    """
                    INSERT INTO usuarios (username, password_hash, role)
                    VALUES (%s, %s, 'admin')
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
    role: Literal["admin", "operador"]


class ProdutoIn(BaseModel):
    nome: str = Field(..., min_length=1)
    preco: float = Field(..., gt=0)
    quantidade_atual: int = Field(0, ge=0)
    estoque_minimo: int = Field(5, ge=0)


class ProdutoUpdate(BaseModel):
    nome: str = Field(..., min_length=1)
    preco: float = Field(..., gt=0)
    estoque_minimo: int | None = Field(None, ge=0)


class ProdutoOut(BaseModel):
    id: int
    nome: str
    preco: float
    quantidade_atual: int
    estoque_minimo: int


class MovimentacaoIn(BaseModel):
    produto_id: int
    tipo: Literal["entrada", "saida"]
    quantidade: int = Field(..., gt=0)


class MovimentacaoOut(BaseModel):
    id: int
    produto_id: int
    tipo: str
    quantidade: int
    usuario_id: int | None = None


class MovimentacaoHistoricoOut(MovimentacaoOut):
    produto_nome: str
    usuario_username: str | None = None
    data_hora: str


class AlertaOut(BaseModel):
    id: int
    produto_id: int
    produto_nome: str
    mensagem: str
    lido_boolean: bool
    data_hora: str


# ---------------------------------------------------------------------------
# Autenticacao
# ---------------------------------------------------------------------------
def criar_token(usuario: dict) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRES_MINUTES)
    payload = {
        "sub": usuario["username"],
        "user_id": usuario["id"],
        "role": usuario["role"],
        "exp": expires_at,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def buscar_usuario(username: str) -> dict | None:
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, username, password_hash, role
                FROM usuarios
                WHERE username = %s
                """,
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

    return UsuarioOut(
        id=usuario["id"],
        username=usuario["username"],
        role=usuario["role"],
    )


def require_admin(usuario: UsuarioOut = Depends(get_current_user)) -> UsuarioOut:
    if usuario.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a administradores.",
        )

    return usuario


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
    _usuario: UsuarioOut = Depends(require_admin),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO produto (nome, preco, quantidade_atual, estoque_minimo)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    produto.nome,
                    produto.preco,
                    produto.quantidade_atual,
                    produto.estoque_minimo,
                ),
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
    _usuario: UsuarioOut = Depends(require_admin),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM produto WHERE id = %s", (produto_id,))
            atual = cursor.fetchone()

            if atual is None:
                raise HTTPException(status_code=404, detail="Produto nao encontrado.")

            estoque_minimo = (
                produto.estoque_minimo
                if produto.estoque_minimo is not None
                else atual["estoque_minimo"]
            )
            cursor.execute(
                """
                UPDATE produto
                SET nome = %s, preco = %s, estoque_minimo = %s
                WHERE id = %s
                """,
                (produto.nome, produto.preco, estoque_minimo, produto_id),
            )
            cursor.execute("SELECT * FROM produto WHERE id = %s", (produto_id,))
            return cursor.fetchone()


@app.delete("/produtos/{produto_id}", status_code=204)
def excluir_produto(
    produto_id: int,
    _usuario: UsuarioOut = Depends(require_admin),
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
def listar_movimentacoes(_usuario: UsuarioOut = Depends(require_admin)):
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
                    m.usuario_id,
                    u.username AS usuario_username,
                    DATE_FORMAT(m.criado_em, '%Y-%m-%d %H:%i:%s') AS data_hora
                FROM movimentacao m
                LEFT JOIN produto p ON p.id = m.produto_id
                LEFT JOIN usuarios u ON u.id = m.usuario_id
                ORDER BY m.id DESC
                """
            )
            return cursor.fetchall()


@app.post("/movimentacoes", response_model=MovimentacaoOut, status_code=201)
def registrar_movimentacao(
    mov: MovimentacaoIn,
    usuario: UsuarioOut = Depends(get_current_user),
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
                INSERT INTO movimentacao (produto_id, usuario_id, tipo, quantidade)
                VALUES (%s, %s, %s, %s)
                """,
                (mov.produto_id, usuario.id, mov.tipo, mov.quantidade),
            )
            cursor.execute(
                """
                SELECT id, produto_id, usuario_id, tipo, quantidade
                FROM movimentacao
                WHERE id = %s
                """,
                (cursor.lastrowid,),
            )
            return cursor.fetchone()


# ---------------------------------------------------------------------------
# Rotas - Alertas
# ---------------------------------------------------------------------------
@app.get("/alertas", response_model=list[AlertaOut])
def listar_alertas(_usuario: UsuarioOut = Depends(get_current_user)):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    a.id,
                    a.produto_id,
                    COALESCE(p.nome, 'Produto removido') AS produto_nome,
                    a.mensagem,
                    a.lido_boolean,
                    DATE_FORMAT(a.data_hora, '%Y-%m-%d %H:%i:%s') AS data_hora
                FROM alertas a
                LEFT JOIN produto p ON p.id = a.produto_id
                WHERE a.lido_boolean = FALSE
                ORDER BY a.id DESC
                """
            )
            return cursor.fetchall()
