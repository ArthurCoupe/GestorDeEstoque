# GestorDeEstoque

Sistema web para controle de estoque com autenticacao JWT, MySQL, RBAC, alertas de estoque baixo, previsao de ruptura e automacao de movimentacoes com IA local via Ollama.

## Visao Geral

O projeto e dividido em:

- `backend/`: API FastAPI com MySQL, JWT, RBAC, auditoria, alertas e rotas de IA.
- `frontend/`: SPA React/Vite com dashboard, produtos, operacoes, historico, notificacoes e assistente de comando por texto.

Principais capacidades:

- login com JWT;
- perfis `admin` e `operador`;
- cadastro, edicao, exclusao e listagem de produtos;
- movimentacoes de entrada e saida;
- historico auditavel com usuario responsavel;
- alertas automaticos de estoque baixo;
- previsao matematica de dias para esgotamento;
- comando em linguagem natural usando Ollama local;
- dashboard com KPIs e grafico Top 5 produtos em estoque;
- exportacao CSV do inventario.

## Stack

### Backend

- Python 3.11+
- FastAPI
- Uvicorn
- PyMySQL
- Passlib + bcrypt
- PyJWT
- MySQL/MariaDB via XAMPP ou instalacao local
- Ollama local para automacao NLP

### Frontend

- React
- Vite
- React Router DOM
- Recharts
- Lucide React
- React Hot Toast
- Tailwind CSS
- Oxlint

## Estrutura

```text
GestorDeEstoque/
|-- backend/
|   |-- main.py
|   |-- requirements.txt
|   `-- .venv/
|-- frontend/
|   |-- src/
|   |   |-- App.jsx
|   |   |-- App.css
|   |   |-- api.js
|   |   |-- main.jsx
|   |   `-- index.css
|   |-- index.html
|   |-- package.json
|   |-- package-lock.json
|   `-- vite.config.js
|-- .gitignore
`-- README.md
```

## Banco de Dados

O backend usa MySQL e cria/migra automaticamente as tabelas no startup.

Banco padrao:

```text
gestor_estoque
```

Tabelas principais:

- `usuarios`: usuarios autenticados, hash de senha e cargo.
- `produto`: produtos, preco, estoque atual e estoque minimo.
- `movimentacao`: entradas/saidas, produto, usuario responsavel e data.
- `alertas`: alertas pendentes ou lidos de estoque baixo.

### RBAC

Roles suportadas:

- `admin`
- `operador`

Permissoes:

| Acao | admin | operador |
| --- | --- | --- |
| Login | Sim | Sim |
| Listar produtos | Sim | Sim |
| Cadastrar produto | Sim | Nao |
| Editar produto | Sim | Nao |
| Excluir produto | Sim | Nao |
| Registrar movimentacao | Sim | Sim |
| Ver historico completo | Sim | Nao |
| Ver alertas | Sim | Sim |
| Usar assistente IA | Sim | Sim |
| Ver previsao de ruptura | Sim | Sim |

Usuario inicial padrao:

```text
Usuario: admin
Senha: admin123
Role: admin
```

## Variaveis de Ambiente

O backend aceita estas variaveis:

| Variavel | Padrao | Descricao |
| --- | --- | --- |
| `MYSQL_HOST` | `localhost` | Host do MySQL |
| `MYSQL_PORT` | `3306` | Porta do MySQL |
| `MYSQL_USER` | `root` | Usuario do MySQL |
| `MYSQL_PASSWORD` | vazio | Senha do MySQL |
| `MYSQL_DATABASE` | `gestor_estoque` | Banco usado pela aplicacao |
| `JWT_SECRET` | `gestor-estoque-dev-secret` | Chave de assinatura JWT |
| `JWT_EXPIRES_MINUTES` | `480` | Expiracao do token |
| `ADMIN_USERNAME` | `admin` | Usuario admin inicial |
| `ADMIN_PASSWORD` | `admin123` | Senha admin inicial |
| `OLLAMA_URL` | `http://localhost:11434/api/generate` | Endpoint local do Ollama |
| `OLLAMA_MODEL` | vazio | Modelo Ollama especifico; se vazio, usa o primeiro instalado |
| `OLLAMA_TIMEOUT_SECONDS` | `60` | Timeout da chamada ao Ollama |

O frontend aceita:

| Variavel | Padrao | Descricao |
| --- | --- | --- |
| `VITE_API_BASE` | `http://127.0.0.1:8000` | URL base da API |

## Como Rodar Localmente

### 1. Subir MySQL no XAMPP

Abra o XAMPP Control Panel e inicie o MySQL.

Se o XAMPP avisar que a porta `3306` esta ocupada, pare o servico concorrente no PowerShell como Administrador:

```powershell
Stop-Service MySQL96
Set-Service MySQL96 -StartupType Manual
```

Depois inicie o MySQL no XAMPP novamente.

### 2. Rodar Backend

No PowerShell:

```powershell
cd C:\Users\arthu\Desktop\Arthur\Projetos\GestorDeEstoque\backend

$env:MYSQL_HOST="127.0.0.1"
$env:MYSQL_PORT="3306"
$env:MYSQL_USER="root"
$env:MYSQL_PASSWORD=""
$env:MYSQL_DATABASE="gestor_estoque"

.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

O backend ficara em:

```text
http://127.0.0.1:8000
```

Swagger:

```text
http://127.0.0.1:8000/docs
```

### 3. Rodar Frontend

Em outro terminal:

```powershell
cd C:\Users\arthu\Desktop\Arthur\Projetos\GestorDeEstoque\frontend
npm.cmd install
npm.cmd run dev
```

O frontend ficara em:

```text
http://localhost:5173
```

## Ollama Local

A rota de IA por texto usa o Ollama em:

```text
http://localhost:11434/api/generate
```

Verifique se o Ollama esta ativo:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:11434/api/tags
```

Se quiser fixar um modelo especifico:

```powershell
$env:OLLAMA_MODEL="qwen2.5-coder:14b"
```

Se `OLLAMA_MODEL` nao for definido, o backend consulta `/api/tags` e usa o primeiro modelo instalado.

## Rotas do Frontend

| Rota | Descricao |
| --- | --- |
| `/` | Dashboard com grafico, KPIs e previsao de esgotamento |
| `/produtos` | Cadastro de produto e inventario atual |
| `/operacoes` | Registro de entradas e saidas |
| `/historico` | Historico auditavel de movimentacoes, visivel para admin |

## Rotas da API

### Autenticacao

| Metodo | Rota | Acesso | Descricao |
| --- | --- | --- | --- |
| `POST` | `/login` | Publico | Retorna JWT |

Payload:

```json
{
  "username": "admin",
  "password": "admin123"
}
```

### Produtos

| Metodo | Rota | Acesso | Descricao |
| --- | --- | --- | --- |
| `GET` | `/produtos` | admin, operador | Lista produtos |
| `POST` | `/produtos` | admin | Cadastra produto |
| `PUT` | `/produtos/{produto_id}` | admin | Edita produto |
| `DELETE` | `/produtos/{produto_id}` | admin | Exclui produto e movimentacoes vinculadas |

Payload de cadastro:

```json
{
  "nome": "Camiseta azul",
  "preco": 49.9,
  "quantidade_atual": 10,
  "estoque_minimo": 5
}
```

### Movimentacoes

| Metodo | Rota | Acesso | Descricao |
| --- | --- | --- | --- |
| `GET` | `/movimentacoes` | admin | Lista historico completo |
| `POST` | `/movimentacoes` | admin, operador | Registra entrada ou saida |

Payload:

```json
{
  "produto_id": 1,
  "tipo": "saida",
  "quantidade": 2
}
```

### Alertas

| Metodo | Rota | Acesso | Descricao |
| --- | --- | --- | --- |
| `GET` | `/alertas` | admin, operador | Lista alertas pendentes |

Comportamento:

- Se o produto fica abaixo do `estoque_minimo`, um alerta e criado ou atualizado.
- Se o produto volta para o minimo ou acima dele, os alertas pendentes desse produto sao marcados como lidos.
- O sino no frontend mostra badge vermelho quando existem alertas pendentes.

### Inteligencia Artificial

| Metodo | Rota | Acesso | Descricao |
| --- | --- | --- | --- |
| `GET` | `/ia/previsao-ruptura` | admin, operador | Calcula media de saidas dos ultimos 7 dias e estima dias para esgotar |
| `POST` | `/ia/movimentacao-texto` | admin, operador | Usa Ollama para converter texto natural em movimentacao |

Payload de NLP:

```json
{
  "texto": "Saiu 5 camisetas azuis"
}
```

Resposta esperada:

```json
{
  "produto_id": 1,
  "produto_nome": "Camiseta azul",
  "tipo": "saida",
  "quantidade": 5,
  "movimentacao": {
    "id": 10,
    "produto_id": 1,
    "tipo": "saida",
    "quantidade": 5,
    "usuario_id": 1
  }
}
```

## Alertas Assincronos

A API usa `BackgroundTasks` do FastAPI para verificar alertas apos:

- cadastro de produto;
- edicao de produto;
- registro de movimentacao manual;
- registro de movimentacao via assistente IA.

Essa verificacao nao bloqueia a resposta principal da rota.

## Comandos Uteis

### Build do frontend

```powershell
cd C:\Users\arthu\Desktop\Arthur\Projetos\GestorDeEstoque\frontend
npm.cmd run build
```

### Lint do frontend

```powershell
cd C:\Users\arthu\Desktop\Arthur\Projetos\GestorDeEstoque\frontend
npm.cmd run lint
```

### Validar sintaxe do backend

```powershell
cd C:\Users\arthu\Desktop\Arthur\Projetos\GestorDeEstoque\backend
.\.venv\Scripts\python.exe -m py_compile main.py
```

### Zerar produtos, movimentacoes e alertas

Execute no PowerShell:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root -e "USE gestor_estoque; SET FOREIGN_KEY_CHECKS = 0; TRUNCATE TABLE alertas; TRUNCATE TABLE movimentacao; TRUNCATE TABLE produto; SET FOREIGN_KEY_CHECKS = 1;"
```

Conferir contagens:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root -e "USE gestor_estoque; SELECT COUNT(*) AS produtos FROM produto; SELECT COUNT(*) AS movimentacoes FROM movimentacao; SELECT COUNT(*) AS alertas FROM alertas;"
```

Usuarios nao sao apagados por esse comando.

## Fluxo de Uso

1. Inicie o MySQL no XAMPP.
2. Rode o backend em `127.0.0.1:8000`.
3. Rode o frontend em `localhost:5173`.
4. Entre com `admin / admin123`.
5. Cadastre produtos e configure `estoque_minimo`.
6. Registre entradas e saidas em `/operacoes`.
7. Acompanhe alertas no sino do header.
8. Use o assistente `Comando IA` para movimentacoes por texto.
9. Consulte previsao de esgotamento no Dashboard.

## Observacoes de Desenvolvimento

- O backend aplica migracoes simples no startup para adaptar bancos antigos.
- O frontend decodifica o JWT para mostrar usuario/cargo e esconder acoes de admin para operadores.
- As regras de seguranca importantes continuam no backend via dependencias FastAPI.
- A rota `/movimentacoes` e restrita a admin porque contem auditoria completa.
- O projeto usa `127.0.0.1` para evitar conflitos comuns entre `localhost`, IPv6 e ambientes Windows/XAMPP.
