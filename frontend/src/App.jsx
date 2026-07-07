import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  cadastrarProduto,
  clearAuthToken,
  editarProduto,
  excluirProduto,
  getAuthToken,
  listarMovimentacoes,
  listarProdutos,
  loginUsuario,
  registrarMovimentacao,
  setAuthToken,
} from "./api";
import "./App.css";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function LoadingLabel({ text }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {text}
    </span>
  );
}

function getStatus(produto) {
  if (produto.quantidade_atual === 0) {
    return {
      label: "Esgotado",
      classes: "bg-red-50 text-red-700 ring-red-200",
    };
  }

  if (produto.quantidade_atual <= 5) {
    return {
      label: "Baixo",
      classes: "bg-amber-50 text-amber-700 ring-amber-200",
    };
  }

  return {
    label: "OK",
    classes: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
}

function formatDate(value) {
  if (!value) return "-";

  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function normalizarBusca(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function criarIndiceProdutosPorNome(produtos) {
  const indice = new Map();

  function adicionarChave(chave, produtoId) {
    if (!chave) return;

    const bucket = indice.get(chave) ?? new Set();
    bucket.add(produtoId);
    indice.set(chave, bucket);
  }

  produtos.forEach((produto) => {
    const nomeNormalizado = normalizarBusca(produto.nome);
    const chaves = new Set([nomeNormalizado]);
    const partes = nomeNormalizado.split(/\s+/).filter(Boolean);

    partes.forEach((parte) => {
      for (let i = 1; i <= parte.length; i += 1) {
        chaves.add(parte.slice(0, i));
      }
    });

    for (let i = 1; i <= nomeNormalizado.length; i += 1) {
      chaves.add(nomeNormalizado.slice(0, i));
    }

    chaves.forEach((chave) => adicionarChave(chave, produto.id));
  });

  return indice;
}

function intersectarIds(idsAtuais, proximosIds) {
  if (!idsAtuais) {
    return new Set(proximosIds);
  }

  return new Set([...idsAtuais].filter((id) => proximosIds.has(id)));
}

function useRouteFocus() {
  const location = useLocation();
  const mainRef = useRef(null);

  useEffect(() => {
    mainRef.current?.focus();
  }, [location.pathname]);

  return mainRef;
}

function useDialogFocusTrap(onClose) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousActiveElement = document.activeElement;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    if (!dialog) return undefined;

    const getFocusableElements = () =>
      Array.from(dialog.querySelectorAll(focusableSelector)).filter(
        (element) => !element.hasAttribute("disabled"),
      );

    const [firstFocusable] = getFocusableElements();
    (firstFocusable ?? dialog).focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      if (previousActiveElement instanceof HTMLElement) {
        previousActiveElement.focus();
      }
    };
  }, [onClose]);

  return dialogRef;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportarProdutosCsv(produtos) {
  const headers = ["ID", "Produto", "Preco", "Estoque", "Status"];
  const rows = produtos.map((produto) => [
    produto.id,
    produto.nome,
    produto.preco,
    produto.quantidade_atual,
    getStatus(produto).label,
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-estoque-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function CardTitle({ eyebrow, title, titleId }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-slate-950" id={titleId}>
        {title}
      </h2>
    </div>
  );
}

function FormProduto({ onSaved }) {
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState("");
  const [qtd, setQtd] = useState("0");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      await cadastrarProduto({
        nome: nome.trim(),
        preco: parseFloat(preco),
        quantidade_atual: parseInt(qtd, 10),
      });

      setNome("");
      setPreco("");
      setQtd("0");
      toast.success("Produto cadastrado com sucesso.");
      await onSaved();
    } catch (err) {
      toast.error(err.message || "Nao foi possivel cadastrar o produto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      onSubmit={handleSubmit}
    >
      <CardTitle eyebrow="Cadastro" title="Novo produto" />

      <div className="space-y-4">
        <label className="block" htmlFor="produto-nome">
          <span className="text-sm font-medium text-slate-700">Nome</span>
          <input
            id="produto-nome"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            required
            placeholder="Ex: Camiseta azul"
          />
        </label>

        <label className="block" htmlFor="produto-preco">
          <span className="text-sm font-medium text-slate-700">Preco</span>
          <input
            id="produto-preco"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            type="number"
            step="0.01"
            min="0.01"
            value={preco}
            onChange={(event) => setPreco(event.target.value)}
            required
            placeholder="0.00"
          />
        </label>

        <label className="block" htmlFor="produto-quantidade">
          <span className="text-sm font-medium text-slate-700">
            Quantidade inicial
          </span>
          <input
            id="produto-quantidade"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            type="number"
            min="0"
            value={qtd}
            onChange={(event) => setQtd(event.target.value)}
            required
          />
        </label>

        <button
          className="inline-flex w-full items-center justify-center rounded-md bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={loading}
        >
          {loading ? <LoadingLabel text="Salvando..." /> : "Cadastrar produto"}
        </button>
      </div>
    </form>
  );
}

function FormMovimentacao({ produtos, onSaved }) {
  const [produtoId, setProdutoId] = useState("");
  const [tipo, setTipo] = useState("entrada");
  const [qtd, setQtd] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      await registrarMovimentacao({
        produto_id: parseInt(produtoId, 10),
        tipo,
        quantidade: parseInt(qtd, 10),
      });

      setQtd("");
      toast.success(
        tipo === "entrada"
          ? "Entrada registrada com sucesso."
          : "Saida registrada com sucesso.",
      );
      await onSaved();
    } catch (err) {
      toast.error(err.message || "Nao foi possivel registrar a movimentacao.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      onSubmit={handleSubmit}
    >
      <CardTitle eyebrow="Estoque" title="Movimentacao" />

      <div className="space-y-4">
        <label className="block" htmlFor="movimentacao-produto">
          <span className="text-sm font-medium text-slate-700">Produto</span>
          <select
            id="movimentacao-produto"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            value={produtoId}
            onChange={(event) => setProdutoId(event.target.value)}
            required
          >
            <option value="">Selecione...</option>
            {produtos.map((produto) => (
              <option key={produto.id} value={produto.id}>
                {produto.nome}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Tipo</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition focus-within:ring-4 focus-within:ring-emerald-100 ${
                tipo === "entrada"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name="tipo"
                value="entrada"
                checked={tipo === "entrada"}
                onChange={(event) => setTipo(event.target.value)}
              />
              Entrada
            </label>

            <label
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition focus-within:ring-4 focus-within:ring-red-100 ${
                tipo === "saida"
                  ? "border-red-500 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name="tipo"
                value="saida"
                checked={tipo === "saida"}
                onChange={(event) => setTipo(event.target.value)}
              />
              Saida
            </label>
          </div>
        </fieldset>

        <label className="block" htmlFor="movimentacao-quantidade">
          <span className="text-sm font-medium text-slate-700">Quantidade</span>
          <input
            id="movimentacao-quantidade"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            type="number"
            min="1"
            value={qtd}
            onChange={(event) => setQtd(event.target.value)}
            required
            placeholder="0"
          />
        </label>

        <button
          className="inline-flex w-full items-center justify-center rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={loading || produtos.length === 0}
        >
          {loading ? (
            <LoadingLabel text="Registrando..." />
          ) : (
            "Registrar movimentacao"
          )}
        </button>
      </div>
    </form>
  );
}

function DashboardEstoque({ produtos }) {
  const topProdutos = useMemo(
    () =>
      [...produtos]
        .sort((a, b) => b.quantidade_atual - a.quantidade_atual)
        .slice(0, 5)
        .map((produto) => ({
          nome:
            produto.nome.length > 18
              ? `${produto.nome.slice(0, 16)}...`
              : produto.nome,
          quantidade: produto.quantidade_atual,
        })),
    [produtos],
  );

  const totalItens = produtos.reduce(
    (total, produto) => total + produto.quantidade_atual,
    0,
  );
  const produtosBaixos = produtos.filter(
    (produto) => produto.quantidade_atual <= 5,
  ).length;

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <CardTitle eyebrow="Dashboard" title="Top 5 produtos em estoque" />
          <p className="text-sm text-slate-500">
            Ordenado por quantidade atual
          </p>
        </div>

        <div className="h-72">
          {topProdutos.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProdutos} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="nome"
                  tick={{ fill: "#475569", fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "#cbd5e1" }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "#475569", fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "#cbd5e1" }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(14, 165, 233, 0.08)" }}
                  contentStyle={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
                  }}
                  formatter={(value) => [`${value} unidades`, "Estoque"]}
                />
                <Bar
                  dataKey="quantidade"
                  fill="#0e7490"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              Cadastre produtos para visualizar o ranking.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Produtos</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {produtos.length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Itens em estoque</p>
          <p className="mt-2 text-3xl font-semibold text-cyan-700">
            {totalItens}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Atencao</p>
          <p className="mt-2 text-3xl font-semibold text-amber-600">
            {produtosBaixos}
          </p>
        </div>
      </div>
    </section>
  );
}

function TabelaProdutos({ produtos, onDelete, onEdit }) {
  const [busca, setBusca] = useState("");
  const indiceProdutosPorNome = useMemo(
    () => criarIndiceProdutosPorNome(produtos),
    [produtos],
  );

  const produtosFiltrados = useMemo(() => {
    const termo = normalizarBusca(busca);

    if (!termo) {
      return produtos;
    }

    const termos = termo.split(/\s+/).filter(Boolean);
    const idsEncontrados = termos.reduce((idsAtuais, termoAtual) => {
      const idsDoTermo = indiceProdutosPorNome.get(termoAtual);

      if (!idsDoTermo) {
        return new Set();
      }

      return intersectarIds(idsAtuais, idsDoTermo);
    }, null);

    if (!idsEncontrados || idsEncontrados.size === 0) {
      return [];
    }

    return produtos.filter((produto) => idsEncontrados.has(produto.id));
  }, [busca, indiceProdutosPorNome, produtos]);

  function handleExport() {
    if (produtos.length === 0) {
      toast.error("Nao ha produtos para exportar.");
      return;
    }

    exportarProdutosCsv(produtos);
    toast.success("Relatorio CSV exportado.");
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <CardTitle eyebrow="Inventario" title="Estoque atual" />

        <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
          <button
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={handleExport}
            disabled={produtos.length === 0}
          >
            Exportar Relatorio (CSV)
          </button>

          <label className="w-full">
            <span className="sr-only">Buscar produto</span>
            <span className="sr-only" id="busca-produto-ajuda">
              Busca indexada em memoria por nome e prefixos dos produtos.
            </span>
            <input
              aria-describedby="busca-produto-ajuda"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome..."
            />
          </label>
        </div>
      </div>

      <div className="mt-1 overflow-x-auto">
        {produtos.length === 0 ? (
          <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
            Nenhum produto cadastrado ainda.
          </div>
        ) : produtosFiltrados.length === 0 ? (
          <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
            Nenhum produto encontrado para a busca informada.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  ID
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Produto
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Preco
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Estoque
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Acoes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {produtosFiltrados.map((produto) => {
                const status = getStatus(produto);

                return (
                  <tr
                    className="transition hover:bg-slate-50"
                    key={produto.id}
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-sm font-medium text-slate-500">
                      #{produto.id}
                    </td>
                    <td className="min-w-52 px-3 py-3 text-sm font-semibold text-slate-950">
                      {produto.nome}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                      {currencyFormatter.format(produto.preco)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-950">
                      {produto.quantidade_atual}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${status.classes}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-md border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-100 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                          type="button"
                          onClick={() => onEdit(produto)}
                        >
                          Editar
                        </button>
                        <button
                          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100"
                          type="button"
                          onClick={() => onDelete(produto)}
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function HistoricoMovimentacoes({ movimentacoes }) {
  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      id="historico"
    >
      <CardTitle eyebrow="Auditoria" title="Historico de movimentacoes" />

      <div className="overflow-x-auto">
        {movimentacoes.length === 0 ? (
          <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
            Nenhuma movimentacao registrada ainda.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Data/Hora
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Produto
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tipo
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Quantidade
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movimentacoes.map((movimentacao) => (
                <tr
                  className="transition hover:bg-slate-50"
                  key={movimentacao.id}
                >
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-600">
                    {formatDate(movimentacao.data_hora)}
                  </td>
                  <td className="min-w-52 px-3 py-3 text-sm font-semibold text-slate-950">
                    {movimentacao.produto_nome}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                        movimentacao.tipo === "entrada"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-red-50 text-red-700 ring-red-200"
                      }`}
                    >
                      {movimentacao.tipo === "entrada" ? "Entrada" : "Saida"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-950">
                    {movimentacao.quantidade}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function EditarProdutoModal({ onClose, onSaved, produto }) {
  const dialogRef = useDialogFocusTrap(onClose);
  const [nome, setNome] = useState(produto.nome);
  const [preco, setPreco] = useState(String(produto.preco));
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      await editarProduto(produto.id, {
        nome: nome.trim(),
        preco: parseFloat(preco),
      });
      toast.success("Produto atualizado com sucesso.");
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message || "Nao foi possivel atualizar o produto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 px-4">
      <form
        aria-labelledby="editar-produto-title"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
        onSubmit={handleSubmit}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <CardTitle
          eyebrow="Edicao"
          title="Editar produto"
          titleId="editar-produto-title"
        />

        <div className="space-y-4">
          <label className="block" htmlFor="editar-produto-nome">
            <span className="text-sm font-medium text-slate-700">Nome</span>
            <input
              id="editar-produto-nome"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              required
            />
          </label>

          <label className="block" htmlFor="editar-produto-preco">
            <span className="text-sm font-medium text-slate-700">Preco</span>
            <input
              id="editar-produto-preco"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              type="number"
              step="0.01"
              min="0.01"
              value={preco}
              onChange={(event) => setPreco(event.target.value)}
              required
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100"
              type="button"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={loading}
            >
              {loading ? <LoadingLabel text="Salvando..." /> : "Salvar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ExcluirProdutoModal({ onClose, onConfirm, produto }) {
  const dialogRef = useDialogFocusTrap(onClose);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm(produto);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 px-4">
      <div
        aria-describedby="excluir-produto-descricao"
        aria-labelledby="excluir-produto-title"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <CardTitle
          eyebrow="Exclusao"
          title="Excluir produto"
          titleId="excluir-produto-title"
        />
        <p className="text-sm text-slate-600" id="excluir-produto-descricao">
          Esta acao remove o produto{" "}
          <span className="font-semibold text-slate-950">{produto.nome}</span> e
          suas movimentacoes vinculadas.
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100"
            type="button"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? <LoadingLabel text="Excluindo..." /> : "Excluir"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("admin");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      const data = await loginUsuario({ username, password });
      setAuthToken(data.access_token);
      toast.success("Login realizado com sucesso.");
      onLogin(data.access_token);
    } catch (err) {
      toast.error(err.message || "Nao foi possivel fazer login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <form
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
        onSubmit={handleSubmit}
      >
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            GestorDeEstoque
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">
            Acessar painel
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Entre com seu usuario para gerenciar o estoque.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block" htmlFor="login-usuario">
            <span className="text-sm font-medium text-slate-700">Usuario</span>
            <input
              id="login-usuario"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoComplete="username"
            />
          </label>

          <label className="block" htmlFor="login-senha">
            <span className="text-sm font-medium text-slate-700">Senha</span>
            <input
              id="login-senha"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              placeholder="admin123"
            />
          </label>

          <button
            className="inline-flex w-full items-center justify-center rounded-md bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={loading}
          >
            {loading ? <LoadingLabel text="Entrando..." /> : "Entrar"}
          </button>
        </div>
      </form>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3200,
          style: {
            borderRadius: "8px",
            fontSize: "14px",
          },
        }}
      />
    </div>
  );
}

const navItems = [
  { label: "Dashboard", to: "/" },
  { label: "Produtos", to: "/produtos" },
  { label: "Operacoes", to: "/operacoes" },
  { label: "Historico", to: "/historico" },
];

function getNavLinkClass({ isActive }) {
  return `rounded-md px-3 py-2 transition focus:outline-none focus:ring-4 focus:ring-cyan-100 ${
    isActive
      ? "bg-slate-950 text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
  }`;
}

function AppHeader({ onLogout }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-cyan-700 focus:shadow"
        href="#conteudo-principal"
      >
        Ir para o conteudo
      </a>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            GestorDeEstoque
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            Controle de inventario
          </h1>
        </div>

        <nav
          aria-label="Navegacao principal"
          className="flex flex-wrap gap-2 text-sm font-medium"
        >
          {navItems.map((item) => (
            <NavLink
              className={getNavLinkClass}
              end={item.to === "/"}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-cyan-100"
            type="button"
            onClick={onLogout}
          >
            Sair
          </button>
        </nav>
      </div>
    </header>
  );
}

function PageLayout({ children, erroGlobal, isLoadingDados }) {
  const mainRef = useRouteFocus();

  return (
    <main
      className="mx-auto grid max-w-7xl gap-6 px-4 py-6 focus:outline-none sm:px-6 lg:px-8"
      id="conteudo-principal"
      ref={mainRef}
      tabIndex={-1}
    >
      {erroGlobal && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          role="alert"
        >
          {erroGlobal}
        </div>
      )}

      {isLoadingDados && (
        <div
          aria-live="polite"
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-700"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Atualizando dados do estoque...
        </div>
      )}

      {children}
    </main>
  );
}

function DashboardPage({ produtos }) {
  return <DashboardEstoque produtos={produtos} />;
}

function ProdutosPage({ onDelete, onEdit, onSaved, produtos }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr] xl:items-start">
      <FormProduto onSaved={onSaved} />
      <TabelaProdutos
        produtos={produtos}
        onDelete={onDelete}
        onEdit={onEdit}
      />
    </div>
  );
}

function OperacoesPage({ onSaved, produtos }) {
  return (
    <section className="mx-auto w-full max-w-xl">
      <FormMovimentacao produtos={produtos} onSaved={onSaved} />
    </section>
  );
}

function HistoricoPage({ movimentacoes }) {
  return <HistoricoMovimentacoes movimentacoes={movimentacoes} />;
}

function AppRoutes({
  erroGlobal,
  isLoadingDados,
  movimentacoes,
  onDeleteProduto,
  onEditProduto,
  onSaved,
  produtos,
}) {
  return (
    <PageLayout erroGlobal={erroGlobal} isLoadingDados={isLoadingDados}>
      <Routes>
        <Route path="/" element={<DashboardPage produtos={produtos} />} />
        <Route
          path="/produtos"
          element={
            <ProdutosPage
              produtos={produtos}
              onDelete={onDeleteProduto}
              onEdit={onEditProduto}
              onSaved={onSaved}
            />
          }
        />
        <Route
          path="/operacoes"
          element={<OperacoesPage produtos={produtos} onSaved={onSaved} />}
        />
        <Route
          path="/historico"
          element={<HistoricoPage movimentacoes={movimentacoes} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PageLayout>
  );
}

export default function App() {
  const [authToken, setAuthTokenState] = useState(() => getAuthToken());
  const [erroGlobal, setErroGlobal] = useState("");
  const [isLoadingDados, setIsLoadingDados] = useState(false);
  const [movimentacoes, setMovimentacoes] = useState([]);
  const [produtoEditando, setProdutoEditando] = useState(null);
  const [produtoExcluindo, setProdutoExcluindo] = useState(null);
  const [produtos, setProdutos] = useState([]);

  const handleLogout = useCallback(() => {
    clearAuthToken();
    setAuthTokenState(null);
    setProdutos([]);
    setMovimentacoes([]);
    setErroGlobal("");
    toast.success("Sessao encerrada.");
  }, []);

  const carregar = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setIsLoadingDados(true);
    try {
      const [produtosData, movimentacoesData] = await Promise.all([
        listarProdutos(),
        listarMovimentacoes(),
      ]);
      setProdutos(produtosData);
      setMovimentacoes(movimentacoesData);
      setErroGlobal("");
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        handleLogout();
        toast.error("Sessao expirada. Faca login novamente.");
        return;
      }

      const message =
        "Nao foi possivel conectar ao backend em http://localhost:8000.";
      setErroGlobal(message);
      toast.error(message, { id: "backend-offline" });
    } finally {
      setIsLoadingDados(false);
    }
  }, [authToken, handleLogout]);

  async function handleExcluirProduto(produto) {
    try {
      await excluirProduto(produto.id);
      toast.success("Produto excluido com sucesso.");
      await carregar();
      setProdutoExcluindo(null);
    } catch (err) {
      toast.error(err.message || "Nao foi possivel excluir o produto.");
    }
  }

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!authToken) {
    return <LoginPage onLogin={setAuthTokenState} />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-100 text-slate-950">
        <AppHeader onLogout={handleLogout} />

        <AppRoutes
          erroGlobal={erroGlobal}
          isLoadingDados={isLoadingDados}
          movimentacoes={movimentacoes}
          onDeleteProduto={setProdutoExcluindo}
          onEditProduto={setProdutoEditando}
          onSaved={carregar}
          produtos={produtos}
        />

        {produtoEditando && (
          <EditarProdutoModal
            produto={produtoEditando}
            onClose={() => setProdutoEditando(null)}
            onSaved={carregar}
          />
        )}

        {produtoExcluindo && (
          <ExcluirProdutoModal
            produto={produtoExcluindo}
            onClose={() => setProdutoExcluindo(null)}
            onConfirm={handleExcluirProduto}
          />
        )}

        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3200,
            style: {
              borderRadius: "8px",
              fontSize: "14px",
            },
          }}
        />
      </div>
    </BrowserRouter>
  );
}
