import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  cadastrarProduto,
  listarProdutos,
  registrarMovimentacao,
} from "./api";
import "./App.css";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

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

function CardTitle({ eyebrow, title }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
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
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Nome</span>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            required
            placeholder="Ex: Camiseta azul"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Preco</span>
          <input
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

        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Quantidade inicial
          </span>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            type="number"
            min="0"
            value={qtd}
            onChange={(event) => setQtd(event.target.value)}
            required
          />
        </label>

        <button
          className="inline-flex w-full items-center justify-center rounded-md bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={loading}
        >
          {loading ? "Salvando..." : "Cadastrar produto"}
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
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Produto</span>
          <select
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
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition ${
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
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition ${
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

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Quantidade</span>
          <input
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
          className="inline-flex w-full items-center justify-center rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={loading || produtos.length === 0}
        >
          {loading ? "Registrando..." : "Registrar movimentacao"}
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

function TabelaProdutos({ produtos }) {
  const [busca, setBusca] = useState("");

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    if (!termo) {
      return produtos;
    }

    return produtos.filter((produto) =>
      produto.nome.toLowerCase().includes(termo),
    );
  }, [busca, produtos]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <CardTitle eyebrow="Inventario" title="Estoque atual" />

        <label className="w-full lg:max-w-xs">
          <span className="sr-only">Buscar produto</span>
          <input
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar por nome..."
          />
        </label>
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

export default function App() {
  const [produtos, setProdutos] = useState([]);
  const [erroGlobal, setErroGlobal] = useState("");

  const carregar = useCallback(async () => {
    try {
      const data = await listarProdutos();
      setProdutos(data);
      setErroGlobal("");
    } catch {
      const message =
        "Nao foi possivel conectar ao backend em http://localhost:8000.";
      setErroGlobal(message);
      toast.error(message, { toastId: "backend-offline" });
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              GestorDeEstoque
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Controle de inventario
            </h1>
          </div>

          <nav className="flex flex-wrap gap-2 text-sm font-medium">
            <a
              className="rounded-md bg-slate-950 px-3 py-2 text-white"
              href="#dashboard"
            >
              Dashboard
            </a>
            <a
              className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              href="#produtos"
            >
              Produtos
            </a>
            <a
              className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              href="#operacoes"
            >
              Operacoes
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {erroGlobal && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {erroGlobal}
          </div>
        )}

        <div id="dashboard">
          <DashboardEstoque produtos={produtos} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px_1fr] xl:items-start">
          <aside className="grid gap-6" id="operacoes">
            <FormProduto onSaved={carregar} />
            <FormMovimentacao produtos={produtos} onSaved={carregar} />
          </aside>

          <div id="produtos">
            <TabelaProdutos produtos={produtos} />
          </div>
        </div>
      </main>

      <ToastContainer
        autoClose={3200}
        closeOnClick
        newestOnTop
        pauseOnHover
        position="top-right"
        theme="colored"
      />
    </div>
  );
}
