"""
GestorDeEstoque - Backend FastAPI

Fase 4:
  - Banco MySQL local
  - Autenticacao JWT
  - Rotas comerciais protegidas
"""

import json
import os
import re
import unicodedata
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
import pymysql
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, status
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
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60"))

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
                    preco_custo DECIMAL(10, 2) NOT NULL DEFAULT 0,
                    preco_venda DECIMAL(10, 2) NOT NULL DEFAULT 0,
                    imposto_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0,
                    taxa_operacional_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0,
                    quantidade_atual INT NOT NULL DEFAULT 0,
                    estoque_minimo INT NOT NULL DEFAULT 5
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute("SHOW COLUMNS FROM produto")
            produto_columns = {column["Field"] for column in cursor.fetchall()}

            if "preco_custo" not in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "ADD COLUMN preco_custo DECIMAL(10, 2) NOT NULL DEFAULT 0"
                )

            if "preco_venda" not in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "ADD COLUMN preco_venda DECIMAL(10, 2) NOT NULL DEFAULT 0"
                )

            if "preco" in produto_columns:
                cursor.execute(
                    """
                    UPDATE produto
                    SET
                        preco_custo = COALESCE(NULLIF(preco_custo, 0), preco),
                        preco_venda = COALESCE(NULLIF(preco_venda, 0), preco)
                    """
                )
                cursor.execute("ALTER TABLE produto DROP COLUMN preco")

            cursor.execute(
                "ALTER TABLE produto "
                "MODIFY preco_custo DECIMAL(10, 2) NOT NULL DEFAULT 0"
            )
            cursor.execute(
                "ALTER TABLE produto "
                "MODIFY preco_venda DECIMAL(10, 2) NOT NULL DEFAULT 0"
            )

            if "imposto_percentual" not in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "ADD COLUMN imposto_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0"
                )

            if "taxa_operacional_percentual" not in produto_columns:
                cursor.execute(
                    "ALTER TABLE produto "
                    "ADD COLUMN taxa_operacional_percentual DECIMAL(5, 2) NOT NULL DEFAULT 0"
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
                    status VARCHAR(20) NOT NULL DEFAULT 'concluido',
                    quantidade INT NOT NULL,
                    valor_bruto_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
                    valor_custo_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
                    valor_impostos_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
                    lucro_liquido DECIMAL(12, 2) NOT NULL DEFAULT 0,
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

            if "status" not in movimentacao_columns:
                cursor.execute(
                    "ALTER TABLE movimentacao "
                    "ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'concluido' "
                    "AFTER tipo"
                )
            else:
                cursor.execute(
                    """
                    UPDATE movimentacao
                    SET status = 'concluido'
                    WHERE status IS NULL OR status = ''
                    """
                )

            cursor.execute(
                """
                UPDATE movimentacao
                SET status = 'concluido'
                WHERE status NOT IN ('orcamento', 'pendente', 'concluido')
                """
            )

            for column_name in (
                "valor_bruto_total",
                "valor_custo_total",
                "valor_impostos_total",
                "lucro_liquido",
            ):
                if column_name not in movimentacao_columns:
                    cursor.execute(
                        "ALTER TABLE movimentacao "
                        f"ADD COLUMN {column_name} DECIMAL(12, 2) "
                        "NOT NULL DEFAULT 0"
                    )

            if "valor_total" in movimentacao_columns:
                cursor.execute(
                    """
                    UPDATE movimentacao
                    SET valor_bruto_total = valor_total
                    WHERE valor_bruto_total = 0 AND valor_total <> 0
                    """
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
    preco_custo: float = Field(..., ge=0)
    preco_venda: float = Field(..., gt=0)
    imposto_percentual: float = Field(0, ge=0)
    taxa_operacional_percentual: float = Field(0, ge=0)
    quantidade_atual: int = Field(0, ge=0)
    estoque_minimo: int = Field(5, ge=0)


class ProdutoUpdate(BaseModel):
    nome: str = Field(..., min_length=1)
    preco_custo: float = Field(..., ge=0)
    preco_venda: float = Field(..., gt=0)
    imposto_percentual: float = Field(0, ge=0)
    taxa_operacional_percentual: float = Field(0, ge=0)
    estoque_minimo: int | None = Field(None, ge=0)


class ProdutoOut(BaseModel):
    id: int
    nome: str
    preco_custo: float
    preco_venda: float
    imposto_percentual: float
    taxa_operacional_percentual: float
    quantidade_atual: int
    estoque_minimo: int


class MovimentacaoIn(BaseModel):
    produto_id: int
    tipo: Literal["entrada", "saida"]
    quantidade: int = Field(..., gt=0)
    status: Literal["orcamento", "pendente", "concluido"] = "concluido"


class MovimentacaoOut(BaseModel):
    id: int
    produto_id: int
    tipo: str
    quantidade: int
    status: str
    valor_bruto_total: float
    valor_custo_total: float
    valor_impostos_total: float
    lucro_liquido: float
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


class PrevisaoRupturaOut(BaseModel):
    produto_id: int
    produto_nome: str
    estoque_atual: int
    media_vendas_diarias: float
    dias_para_esgotar: float | None


class DashboardStatsOut(BaseModel):
    periodo_inicio: str
    periodo_fim: str
    valor_bruto_periodo: float
    valor_impostos_periodo: float
    lucro_liquido_periodo: float
    total_vendas: float
    qtd_vendas: int
    total_liquido: float
    total_orcamentos: float
    qtd_orcamentos: int
    pedidos_sem_confirmacao: int


class MovimentacaoTextoIn(BaseModel):
    texto: str = Field(..., min_length=3)


class MovimentacaoTextoOut(BaseModel):
    produto_id: int
    produto_nome: str
    tipo: Literal["entrada", "saida"]
    quantidade: int
    movimentacao: MovimentacaoOut


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
# Servicos de dominio
# ---------------------------------------------------------------------------
def normalizar_texto(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    without_accents = "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    )
    return without_accents.lower().strip()


def _parse_periodo_datetime(value: str | None, fallback: datetime, field: str) -> datetime:
    if not value:
        return fallback

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Parametro de periodo invalido: {field}.",
        ) from exc

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)

    return parsed


def executar_movimentacao(mov: MovimentacaoIn, usuario: UsuarioOut) -> dict:
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM produto WHERE id = %s", (mov.produto_id,))
            produto = cursor.fetchone()

            if produto is None:
                raise HTTPException(status_code=404, detail="Produto nao encontrado.")

            deve_alterar_estoque = mov.tipo == "entrada" or mov.status in (
                "pendente",
                "concluido",
            )

            if mov.tipo == "entrada":
                nova_qtd = produto["quantidade_atual"] + mov.quantidade
            elif deve_alterar_estoque:
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
            else:
                nova_qtd = produto["quantidade_atual"]

            valor_custo_total = round(
                mov.quantidade * float(produto["preco_custo"] or 0),
                2,
            )
            carga_percentual = float(produto["imposto_percentual"] or 0) + float(
                produto["taxa_operacional_percentual"] or 0
            )

            if mov.tipo == "saida":
                valor_bruto_total = round(
                    mov.quantidade * float(produto["preco_venda"] or 0),
                    2,
                )
                valor_impostos_total = round(
                    valor_bruto_total * (carga_percentual / 100),
                    2,
                )
                lucro_liquido = round(
                    valor_bruto_total - valor_custo_total - valor_impostos_total,
                    2,
                )
            else:
                valor_bruto_total = valor_custo_total
                valor_impostos_total = round(
                    valor_bruto_total * (carga_percentual / 100),
                    2,
                )
                lucro_liquido = round(
                    valor_custo_total + valor_impostos_total,
                    2,
                )

            if deve_alterar_estoque:
                cursor.execute(
                    "UPDATE produto SET quantidade_atual = %s WHERE id = %s",
                    (nova_qtd, mov.produto_id),
                )
            cursor.execute(
                """
                INSERT INTO movimentacao (
                    produto_id,
                    usuario_id,
                    tipo,
                    status,
                    quantidade,
                    valor_bruto_total,
                    valor_custo_total,
                    valor_impostos_total,
                    lucro_liquido
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    mov.produto_id,
                    usuario.id,
                    mov.tipo,
                    mov.status,
                    mov.quantidade,
                    valor_bruto_total,
                    valor_custo_total,
                    valor_impostos_total,
                    lucro_liquido,
                ),
            )
            cursor.execute(
                """
                SELECT
                    id,
                    produto_id,
                    usuario_id,
                    tipo,
                    status,
                    quantidade,
                    valor_bruto_total,
                    valor_custo_total,
                    valor_impostos_total,
                    lucro_liquido
                FROM movimentacao
                WHERE id = %s
                """,
                (cursor.lastrowid,),
            )
            return cursor.fetchone()


def verificar_alerta_estoque_baixo(produto_id: int) -> None:
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM produto WHERE id = %s", (produto_id,))
            produto = cursor.fetchone()

            if produto is None:
                return

            if produto["quantidade_atual"] >= produto["estoque_minimo"]:
                cursor.execute(
                    """
                    UPDATE alertas
                    SET lido_boolean = TRUE
                    WHERE produto_id = %s AND lido_boolean = FALSE
                    """,
                    (produto_id,),
                )
                return

            mensagem = (
                f"Estoque baixo para {produto['nome']}: "
                f"{produto['quantidade_atual']} unidade(s), "
                f"minimo configurado {produto['estoque_minimo']}."
            )
            cursor.execute(
                """
                SELECT id
                FROM alertas
                WHERE produto_id = %s AND lido_boolean = FALSE
                LIMIT 1
                """,
                (produto_id,),
            )
            alerta_existente = cursor.fetchone()

            if alerta_existente:
                cursor.execute(
                    """
                    UPDATE alertas
                    SET mensagem = %s, data_hora = CURRENT_TIMESTAMP
                    WHERE id = %s
                    """,
                    (mensagem, alerta_existente["id"]),
                )
                return

            cursor.execute(
                """
                INSERT INTO alertas (produto_id, mensagem)
                VALUES (%s, %s)
                """,
                (produto_id, mensagem),
            )


def extrair_json_ollama(texto_resposta: str) -> dict:
    try:
        return json.loads(texto_resposta)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", texto_resposta, re.DOTALL)
        if not match:
            raise HTTPException(
                status_code=502,
                detail="A resposta do Ollama nao contem um JSON valido.",
            )

        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=502,
                detail="A resposta do Ollama nao contem um JSON valido.",
            ) from exc


def resolver_modelo_ollama() -> str:
    if OLLAMA_MODEL:
        return OLLAMA_MODEL

    tags_url = OLLAMA_URL.replace("/api/generate", "/api/tags")

    try:
        with urllib.request.urlopen(
            tags_url,
            timeout=OLLAMA_TIMEOUT_SECONDS,
        ) as response:
            tags_data = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=503,
            detail="Ollama local indisponivel em http://localhost:11434.",
        ) from exc

    modelos = tags_data.get("models", [])
    if not modelos:
        raise HTTPException(
            status_code=503,
            detail="Nenhum modelo Ollama local esta instalado.",
        )

    return modelos[0]["name"]


def chamar_ollama_para_movimentacao(texto: str, produtos: list[dict]) -> dict:
    produtos_prompt = "\n".join(
        f"- {produto['nome']}" for produto in produtos
    )
    prompt = f"""
Extraia uma movimentacao de estoque do texto do usuario.
Produtos cadastrados:
{produtos_prompt}

Responda apenas com JSON valido no formato:
{{"nome_produto":"nome exato do produto", "tipo":"entrada ou saida", "quantidade":1}}

Regras:
- Use "saida" para vendas, retirada, baixa, saiu ou acabou.
- Use "entrada" para chegada, reposicao, compra ou entrada.
- A quantidade deve ser um inteiro positivo.

Texto: {texto}
"""
    payload = {
        "model": resolver_modelo_ollama(),
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }
    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=OLLAMA_TIMEOUT_SECONDS,
        ) as response:
            ollama_data = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=503,
            detail="Ollama local indisponivel em http://localhost:11434.",
        ) from exc

    return extrair_json_ollama(ollama_data.get("response", ""))


def validar_movimentacao_extraida(extraido: dict) -> dict:
    nome_produto = (
        extraido.get("nome_produto")
        or extraido.get("produto")
        or extraido.get("nome")
        or ""
    )
    tipo = str(extraido.get("tipo", "")).lower().strip()

    try:
        quantidade = int(extraido.get("quantidade", 0))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="A IA nao conseguiu identificar uma quantidade valida.",
        ) from exc

    if tipo not in {"entrada", "saida"}:
        raise HTTPException(
            status_code=422,
            detail="A IA nao conseguiu identificar se a movimentacao e entrada ou saida.",
        )

    if quantidade <= 0:
        raise HTTPException(
            status_code=422,
            detail="A IA nao conseguiu identificar uma quantidade positiva.",
        )

    if not nome_produto:
        raise HTTPException(
            status_code=422,
            detail="A IA nao conseguiu identificar o produto.",
        )

    return {
        "nome_produto": nome_produto,
        "tipo": tipo,
        "quantidade": quantidade,
    }


def encontrar_produto_por_nome(nome_extraido: str, produtos: list[dict]) -> dict | None:
    nome_normalizado = normalizar_texto(nome_extraido)

    for produto in produtos:
        if normalizar_texto(produto["nome"]) == nome_normalizado:
            return produto

    for produto in produtos:
        nome_produto = normalizar_texto(produto["nome"])
        if nome_normalizado in nome_produto or nome_produto in nome_normalizado:
            return produto

    return None


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
    background_tasks: BackgroundTasks,
    _usuario: UsuarioOut = Depends(require_admin),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO produto (
                    nome,
                    preco_custo,
                    preco_venda,
                    imposto_percentual,
                    taxa_operacional_percentual,
                    quantidade_atual,
                    estoque_minimo
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    produto.nome,
                    produto.preco_custo,
                    produto.preco_venda,
                    produto.imposto_percentual,
                    produto.taxa_operacional_percentual,
                    produto.quantidade_atual,
                    produto.estoque_minimo,
                ),
            )
            cursor.execute(
                "SELECT * FROM produto WHERE id = %s",
                (cursor.lastrowid,),
            )
            produto_criado = cursor.fetchone()

    background_tasks.add_task(verificar_alerta_estoque_baixo, produto_criado["id"])
    return produto_criado


@app.put("/produtos/{produto_id}", response_model=ProdutoOut)
def editar_produto(
    produto_id: int,
    produto: ProdutoUpdate,
    background_tasks: BackgroundTasks,
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
                SET
                    nome = %s,
                    preco_custo = %s,
                    preco_venda = %s,
                    imposto_percentual = %s,
                    taxa_operacional_percentual = %s,
                    estoque_minimo = %s
                WHERE id = %s
                """,
                (
                    produto.nome,
                    produto.preco_custo,
                    produto.preco_venda,
                    produto.imposto_percentual,
                    produto.taxa_operacional_percentual,
                    estoque_minimo,
                    produto_id,
                ),
            )
            cursor.execute("SELECT * FROM produto WHERE id = %s", (produto_id,))
            produto_atualizado = cursor.fetchone()

    background_tasks.add_task(verificar_alerta_estoque_baixo, produto_id)
    return produto_atualizado


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
                    m.status,
                    m.quantidade,
                    m.valor_bruto_total,
                    m.valor_custo_total,
                    m.valor_impostos_total,
                    m.lucro_liquido,
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
    background_tasks: BackgroundTasks,
    usuario: UsuarioOut = Depends(get_current_user),
):
    movimentacao = executar_movimentacao(mov, usuario)
    background_tasks.add_task(verificar_alerta_estoque_baixo, mov.produto_id)
    return movimentacao


@app.get("/dashboard/estatisticas", response_model=DashboardStatsOut)
def obter_estatisticas_dashboard(
    inicio: str | None = None,
    fim: str | None = None,
    _usuario: UsuarioOut = Depends(get_current_user),
):
    agora = datetime.now()
    periodo_inicio = _parse_periodo_datetime(
        inicio,
        agora.replace(day=1, hour=0, minute=0, second=0, microsecond=0),
        "inicio",
    )
    periodo_fim = _parse_periodo_datetime(fim, agora, "fim")

    if periodo_inicio >= periodo_fim:
        raise HTTPException(
            status_code=400,
            detail="O inicio do periodo deve ser anterior ao fim.",
        )

    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    COALESCE(SUM(
                        CASE
                            WHEN tipo = 'saida' AND status = 'concluido'
                            THEN valor_bruto_total
                            ELSE 0
                        END
                    ), 0) AS total_vendas,
                    COALESCE(SUM(
                        CASE
                            WHEN tipo = 'saida' AND status = 'concluido'
                            THEN lucro_liquido
                            ELSE 0
                        END
                    ), 0) AS total_liquido,
                    COALESCE(SUM(
                        CASE
                            WHEN tipo = 'saida' AND status = 'concluido'
                            THEN valor_impostos_total
                            ELSE 0
                        END
                    ), 0) AS valor_impostos_periodo,
                    COALESCE(SUM(
                        CASE
                            WHEN tipo = 'saida' AND status = 'orcamento'
                            THEN valor_bruto_total
                            ELSE 0
                        END
                    ), 0) AS total_orcamentos,
                    SUM(CASE WHEN tipo = 'saida' AND status = 'concluido' THEN 1 ELSE 0 END)
                        AS qtd_vendas,
                    SUM(CASE WHEN tipo = 'saida' AND status = 'orcamento' THEN 1 ELSE 0 END)
                        AS qtd_orcamentos,
                    SUM(CASE WHEN tipo = 'saida' AND status = 'pendente' THEN 1 ELSE 0 END)
                        AS pedidos_sem_confirmacao
                FROM movimentacao
                WHERE tipo = 'saida'
                    AND criado_em >= %s
                    AND criado_em <= %s
                """,
                (periodo_inicio, periodo_fim),
            )
            row = cursor.fetchone()

    return {
        "periodo_inicio": periodo_inicio.isoformat(timespec="seconds"),
        "periodo_fim": periodo_fim.isoformat(timespec="seconds"),
        "valor_bruto_periodo": float(row["total_vendas"] or 0),
        "valor_impostos_periodo": float(row["valor_impostos_periodo"] or 0),
        "lucro_liquido_periodo": float(row["total_liquido"] or 0),
        "total_vendas": float(row["total_vendas"] or 0),
        "qtd_vendas": int(row["qtd_vendas"] or 0),
        "total_liquido": float(row["total_liquido"] or 0),
        "total_orcamentos": float(row["total_orcamentos"] or 0),
        "qtd_orcamentos": int(row["qtd_orcamentos"] or 0),
        "pedidos_sem_confirmacao": int(row["pedidos_sem_confirmacao"] or 0),
    }


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


# ---------------------------------------------------------------------------
# Rotas - Inteligencia artificial
# ---------------------------------------------------------------------------
@app.get("/ia/previsao-ruptura", response_model=list[PrevisaoRupturaOut])
def listar_previsao_ruptura(_usuario: UsuarioOut = Depends(get_current_user)):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    p.id AS produto_id,
                    p.nome AS produto_nome,
                    p.quantidade_atual AS estoque_atual,
                    COALESCE(SUM(
                        CASE
                            WHEN m.tipo = 'saida'
                                AND m.status IN ('pendente', 'concluido')
                                AND m.criado_em >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                            THEN m.quantidade
                            ELSE 0
                        END
                    ), 0) AS saidas_7d
                FROM produto p
                LEFT JOIN movimentacao m ON m.produto_id = p.id
                GROUP BY p.id, p.nome, p.quantidade_atual
                ORDER BY p.id
                """
            )
            previsoes = []

            for row in cursor.fetchall():
                media_diaria = round(float(row["saidas_7d"]) / 7, 2)
                dias_para_esgotar = (
                    None
                    if media_diaria <= 0
                    else round(row["estoque_atual"] / media_diaria, 1)
                )
                previsoes.append(
                    {
                        "produto_id": row["produto_id"],
                        "produto_nome": row["produto_nome"],
                        "estoque_atual": row["estoque_atual"],
                        "media_vendas_diarias": media_diaria,
                        "dias_para_esgotar": dias_para_esgotar,
                    }
                )

            return previsoes


@app.post("/ia/movimentacao-texto", response_model=MovimentacaoTextoOut)
def registrar_movimentacao_por_texto(
    payload: MovimentacaoTextoIn,
    background_tasks: BackgroundTasks,
    usuario: UsuarioOut = Depends(get_current_user),
):
    with get_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id, nome FROM produto ORDER BY nome")
            produtos = cursor.fetchall()

    if not produtos:
        raise HTTPException(
            status_code=400,
            detail="Cadastre produtos antes de usar o assistente IA.",
        )

    extraido = validar_movimentacao_extraida(
        chamar_ollama_para_movimentacao(payload.texto, produtos)
    )
    produto = encontrar_produto_por_nome(extraido["nome_produto"], produtos)

    if produto is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Produto identificado pela IA nao foi encontrado no estoque: "
                f"{extraido['nome_produto']}."
            ),
        )

    movimentacao = executar_movimentacao(
        MovimentacaoIn(
            produto_id=produto["id"],
            tipo=extraido["tipo"],
            quantidade=extraido["quantidade"],
        ),
        usuario,
    )
    background_tasks.add_task(verificar_alerta_estoque_baixo, produto["id"])

    return {
        "produto_id": produto["id"],
        "produto_nome": produto["nome"],
        "tipo": extraido["tipo"],
        "quantidade": extraido["quantidade"],
        "movimentacao": movimentacao,
    }
