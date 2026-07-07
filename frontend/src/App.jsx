import { useState, useEffect, useCallback } from "react";
import {
  listarProdutos,
  cadastrarProduto,
  registrarMovimentacao,
} from "./api";
import "./App.css";

/* ------------------------------------------------------------------ */
/*  Componente: Formulário de Produto                                 */
/* ------------------------------------------------------------------ */
function FormProduto({ onSaved }) {
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState("");
  const [qtd, setQtd] = useState("0");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setLoading(true);
    try {
      await cadastrarProduto({
        nome,
        preco: parseFloat(preco),
        quantidade_atual: parseInt(qtd, 10),
      });
      setNome("");
      setPreco("");
      setQtd("0");
      onSaved();
    } catch (err) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <h2>
        <span className="icon">📦</span> Novo Produto
      </h2>

      <label>
        Nome
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          placeholder="Ex: Camiseta Azul"
        />
      </label>

      <label>
        Preço (R$)
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          required
          placeholder="0.00"
        />
      </label>

      <label>
        Quantidade inicial
        <input
          type="number"
          min="0"
          value={qtd}
          onChange={(e) => setQtd(e.target.value)}
          required
        />
      </label>

      {erro && <p className="erro">{erro}</p>}
      <button type="submit" disabled={loading}>
        {loading ? "Salvando…" : "Cadastrar"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Componente: Formulário de Movimentação                            */
/* ------------------------------------------------------------------ */
function FormMovimentacao({ produtos, onSaved }) {
  const [produtoId, setProdutoId] = useState("");
  const [tipo, setTipo] = useState("entrada");
  const [qtd, setQtd] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setLoading(true);
    try {
      await registrarMovimentacao({
        produto_id: parseInt(produtoId, 10),
        tipo,
        quantidade: parseInt(qtd, 10),
      });
      setQtd("");
      onSaved();
    } catch (err) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <h2>
        <span className="icon">🔄</span> Movimentação
      </h2>

      <label>
        Produto
        <select
          value={produtoId}
          onChange={(e) => setProdutoId(e.target.value)}
          required
        >
          <option value="">Selecione…</option>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>

      <label>
        Tipo
        <div className="radio-group">
          <label className={`radio-label ${tipo === "entrada" ? "active entrada" : ""}`}>
            <input
              type="radio"
              name="tipo"
              value="entrada"
              checked={tipo === "entrada"}
              onChange={(e) => setTipo(e.target.value)}
            />
            ➕ Entrada
          </label>
          <label className={`radio-label ${tipo === "saida" ? "active saida" : ""}`}>
            <input
              type="radio"
              name="tipo"
              value="saida"
              checked={tipo === "saida"}
              onChange={(e) => setTipo(e.target.value)}
            />
            ➖ Saída
          </label>
        </div>
      </label>

      <label>
        Quantidade
        <input
          type="number"
          min="1"
          value={qtd}
          onChange={(e) => setQtd(e.target.value)}
          required
          placeholder="0"
        />
      </label>

      {erro && <p className="erro">{erro}</p>}
      <button type="submit" disabled={loading}>
        {loading ? "Registrando…" : "Registrar"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Componente: Tabela de Produtos                                    */
/* ------------------------------------------------------------------ */
function TabelaProdutos({ produtos }) {
  if (produtos.length === 0) {
    return (
      <div className="card empty-state">
        <span className="empty-icon">📋</span>
        <p>Nenhum produto cadastrado ainda.</p>
        <p className="hint">Use o formulário ao lado para começar.</p>
      </div>
    );
  }

  return (
    <div className="card table-card">
      <h2>
        <span className="icon">📊</span> Estoque Atual
      </h2>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Produto</th>
              <th>Preço</th>
              <th>Estoque</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <tr key={p.id}>
                <td className="id-cell">#{p.id}</td>
                <td className="nome-cell">{p.nome}</td>
                <td className="preco-cell">
                  R$ {p.preco.toFixed(2)}
                </td>
                <td className="qtd-cell">{p.quantidade_atual}</td>
                <td>
                  <span
                    className={`badge ${
                      p.quantidade_atual === 0
                        ? "badge-danger"
                        : p.quantidade_atual <= 5
                        ? "badge-warning"
                        : "badge-ok"
                    }`}
                  >
                    {p.quantidade_atual === 0
                      ? "Esgotado"
                      : p.quantidade_atual <= 5
                      ? "Baixo"
                      : "OK"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App Principal                                                     */
/* ------------------------------------------------------------------ */
export default function App() {
  const [produtos, setProdutos] = useState([]);
  const [erroGlobal, setErroGlobal] = useState("");

  const carregar = useCallback(async () => {
    try {
      const data = await listarProdutos();
      setProdutos(data);
      setErroGlobal("");
    } catch {
      setErroGlobal(
        "Não foi possível conectar ao backend. Verifique se ele está rodando em http://localhost:8000"
      );
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="app">
      <header>
        <h1>
          <span className="logo">📦</span> GestorDeEstoque
        </h1>
        <p className="subtitle">Controle de inventário simplificado</p>
      </header>

      {erroGlobal && (
        <div className="erro-global">
          <span>⚠️</span> {erroGlobal}
        </div>
      )}

      <main>
        <section className="sidebar">
          <FormProduto onSaved={carregar} />
          <FormMovimentacao produtos={produtos} onSaved={carregar} />
        </section>

        <section className="content">
          <TabelaProdutos produtos={produtos} />
        </section>
      </main>
    </div>
  );
}
