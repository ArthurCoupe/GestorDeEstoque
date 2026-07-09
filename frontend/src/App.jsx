import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bot, Loader2 } from "lucide-react";
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
  listarAlertas,
  listarMovimentacoes,
  listarPrevisaoRuptura,
  listarProdutos,
  loginUsuario,
  obterEstatisticasDashboard,
  registrarMovimentacao,
  registrarMovimentacaoTexto,
  setAuthToken,
} from "./api";
import "./App.css";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function asNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calcularMargemBruta(produto) {
  const precoVenda = asNumber(produto.preco_venda);

  if (precoVenda <= 0) {
    return 0;
  }

  return ((precoVenda - asNumber(produto.preco_custo)) / precoVenda) * 100;
}

function formatPercent(value) {
  return `${asNumber(value).toFixed(2)}%`;
}

function decodeAuthToken(token) {
  if (!token) return null;

  try {
    const payload = token.split(".")[1];
    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "=",
    );
    const data = JSON.parse(atob(paddedPayload));

    return {
      id: data.user_id,
      username: data.sub,
      role: data.role ?? "admin",
    };
  } catch {
    return null;
  }
}

function formatRole(role) {
  return role === "admin" ? "Admin" : "Operador";
}

function formatarPrevisao(previsao) {
  if (!previsao) {
    return "Sem dados";
  }

  if (previsao.estoque_atual === 0) {
    return "Esgotado";
  }

  if (previsao.dias_para_esgotar === null) {
    return "Sem consumo recente";
  }

  return `${previsao.dias_para_esgotar} dia(s)`;
}

function getVendaStatusLabel(statusVenda) {
  const labels = {
    orcamento: "Orcamento",
    pendente: "Aguardando confirmacao",
    concluido: "Concluido",
  };

  return labels[statusVenda] ?? "Concluido";
}

function getVendaStatusClasses(statusVenda) {
  if (statusVenda === "orcamento") {
    return "bg-teal-50 text-teal-700 ring-teal-200";
  }

  if (statusVenda === "pendente") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  return "bg-blue-50 text-blue-700 ring-blue-200";
}

function LoadingLabel({ text }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {text}
    </span>
  );
}

function getStatus(produto) {
  const estoqueMinimo = produto.estoque_minimo ?? 5;

  if (produto.quantidade_atual === 0) {
    return {
      label: "Esgotado",
      classes: "bg-red-50 text-red-700 ring-red-200",
    };
  }

  if (produto.quantidade_atual <= estoqueMinimo) {
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getReportRisk(produto) {
  const estoqueMinimo = produto.estoque_minimo ?? 5;

  if (produto.quantidade_atual === 0) {
    return {
      label: "Critico",
      className: "status-critical",
      note: "Produto esgotado. Reposicao imediata recomendada.",
    };
  }

  if (produto.quantidade_atual < estoqueMinimo) {
    return {
      label: "Abaixo do minimo",
      className: "status-low",
      note: "Estoque abaixo do limite operacional.",
    };
  }

  if (produto.quantidade_atual === estoqueMinimo) {
    return {
      label: "No limite",
      className: "status-watch",
      note: "Produto exatamente no estoque minimo.",
    };
  }

  return {
    label: "Saudavel",
    className: "status-ok",
    note: "Estoque acima do minimo configurado.",
  };
}

function formatExcelNumber(value) {
  return Number(value || 0).toFixed(2);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function buildProdutosExcelHtml(produtos) {
  const dataGeracao = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  const totalProdutos = produtos.length;
  const totalItens = produtos.reduce(
    (total, produto) => total + produto.quantidade_atual,
    0,
  );
  const valorTotalCusto = produtos.reduce(
    (total, produto) =>
      total + asNumber(produto.preco_custo) * produto.quantidade_atual,
    0,
  );
  const valorTotalVenda = produtos.reduce(
    (total, produto) =>
      total + asNumber(produto.preco_venda) * produto.quantidade_atual,
    0,
  );
  const margemMedia =
    valorTotalVenda > 0
      ? ((valorTotalVenda - valorTotalCusto) / valorTotalVenda) * 100
      : 0;
  const produtosEsgotados = produtos.filter(
    (produto) => produto.quantidade_atual === 0,
  ).length;
  const produtosAbaixoMinimo = produtos.filter(
    (produto) =>
      produto.quantidade_atual > 0 &&
      produto.quantidade_atual < (produto.estoque_minimo ?? 5),
  ).length;
  const produtosNoLimite = produtos.filter(
    (produto) => produto.quantidade_atual === (produto.estoque_minimo ?? 5),
  ).length;
  const reposicaoSugerida = produtos.reduce((total, produto) => {
    const estoqueMinimo = produto.estoque_minimo ?? 5;
    return total + Math.max(estoqueMinimo - produto.quantidade_atual, 0);
  }, 0);
  const sortedProdutos = [...produtos].sort((a, b) => {
    const statusA = a.quantidade_atual - (a.estoque_minimo ?? 5);
    const statusB = b.quantidade_atual - (b.estoque_minimo ?? 5);

    if (statusA !== statusB) return statusA - statusB;
    return a.nome.localeCompare(b.nome);
  });

  const rows = sortedProdutos
    .map((produto) => {
      const estoqueMinimo = produto.estoque_minimo ?? 5;
      const diferencaMinimo = produto.quantidade_atual - estoqueMinimo;
      const quantidadeRepor = Math.max(estoqueMinimo - produto.quantidade_atual, 0);
      const precoCusto = asNumber(produto.preco_custo);
      const precoVenda = asNumber(produto.preco_venda);
      const margemBruta = calcularMargemBruta(produto);
      const valorEstoqueCusto = precoCusto * produto.quantidade_atual;
      const valorVendaPotencial = precoVenda * produto.quantidade_atual;
      const risco = getReportRisk(produto);

      return `
        <tr>
          <td class="text">#${escapeHtml(produto.id)}</td>
          <td class="text product">${escapeHtml(produto.nome)}</td>
          <td class="money">${formatExcelNumber(precoCusto)}</td>
          <td class="money">${formatExcelNumber(precoVenda)}</td>
          <td class="percent">${formatExcelNumber(margemBruta / 100)}</td>
          <td class="percent">${formatExcelNumber(asNumber(produto.imposto_percentual) / 100)}</td>
          <td class="percent">${formatExcelNumber(asNumber(produto.taxa_operacional_percentual) / 100)}</td>
          <td class="number">${produto.quantidade_atual}</td>
          <td class="number">${estoqueMinimo}</td>
          <td class="number">${diferencaMinimo}</td>
          <td class="number">${quantidadeRepor}</td>
          <td class="money">${formatExcelNumber(valorEstoqueCusto)}</td>
          <td class="money">${formatExcelNumber(valorVendaPotencial)}</td>
          <td class="${risco.className}">${escapeHtml(risco.label)}</td>
          <td class="text">${escapeHtml(risco.note)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Relatorio Estoque</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                  <x:FreezePanes/>
                  <x:FrozenNoSplit/>
                  <x:SplitHorizontal>11</x:SplitHorizontal>
                  <x:TopRowBottomPane>11</x:TopRowBottomPane>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body {
            font-family: Arial, sans-serif;
            color: #0f172a;
          }
          table {
            border-collapse: collapse;
          }
          .title {
            background: #0f172a;
            color: #ffffff;
            font-size: 22px;
            font-weight: 700;
            height: 34px;
          }
          .subtitle {
            background: #e0f2fe;
            color: #075985;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .section {
            background: #164e63;
            color: #ffffff;
            font-weight: 700;
          }
          .metric-label {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            color: #475569;
            font-weight: 700;
          }
          .metric-value {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #0f172a;
            font-size: 16px;
            font-weight: 700;
          }
          th {
            background: #0e7490;
            border: 1px solid #0f5f75;
            color: #ffffff;
            font-weight: 700;
            height: 26px;
          }
          td {
            border: 1px solid #dbe4ee;
            height: 24px;
            padding: 4px;
          }
          .text {
            mso-number-format: "\\@";
          }
          .product {
            font-weight: 700;
          }
          .number {
            mso-number-format: "#,##0";
            text-align: right;
          }
          .money {
            mso-number-format: "\\0022R$\\0022 #,##0.00";
            text-align: right;
          }
          .percent {
            mso-number-format: "0.00%";
            text-align: right;
          }
          .status-ok {
            background: #dcfce7;
            color: #166534;
            font-weight: 700;
          }
          .status-watch {
            background: #fef9c3;
            color: #854d0e;
            font-weight: 700;
          }
          .status-low {
            background: #ffedd5;
            color: #9a3412;
            font-weight: 700;
          }
          .status-critical {
            background: #fee2e2;
            color: #991b1b;
            font-weight: 700;
          }
          .muted {
            color: #64748b;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <table>
          <colgroup>
            <col style="width: 70px" />
            <col style="width: 260px" />
            <col style="width: 120px" />
            <col style="width: 120px" />
            <col style="width: 120px" />
            <col style="width: 110px" />
            <col style="width: 120px" />
            <col style="width: 110px" />
            <col style="width: 110px" />
            <col style="width: 120px" />
            <col style="width: 130px" />
            <col style="width: 140px" />
            <col style="width: 160px" />
            <col style="width: 150px" />
            <col style="width: 360px" />
          </colgroup>
          <tr>
            <td class="title" colspan="15">GestorDeEstoque - Relatorio Executivo de Inventario</td>
          </tr>
          <tr>
            <td class="subtitle" colspan="15">Gerado em ${escapeHtml(dataGeracao)}</td>
          </tr>
          <tr><td colspan="15"></td></tr>
          <tr>
            <td class="section" colspan="15">Resumo operacional</td>
          </tr>
          <tr>
            <td class="metric-label" colspan="2">Produtos cadastrados</td>
            <td class="metric-value number">${totalProdutos}</td>
            <td class="metric-label" colspan="2">Itens em estoque</td>
            <td class="metric-value number">${totalItens}</td>
            <td class="metric-label" colspan="2">Estoque a custo</td>
            <td class="metric-value money" colspan="2">${formatExcelNumber(valorTotalCusto)}</td>
            <td class="metric-label" colspan="2">Venda potencial</td>
            <td class="metric-value money" colspan="3">${formatExcelNumber(valorTotalVenda)}</td>
          </tr>
          <tr>
            <td class="metric-label" colspan="2">Esgotados</td>
            <td class="metric-value number">${produtosEsgotados}</td>
            <td class="metric-label" colspan="2">Abaixo do minimo</td>
            <td class="metric-value number">${produtosAbaixoMinimo}</td>
            <td class="metric-label" colspan="2">No limite</td>
            <td class="metric-value number">${produtosNoLimite}</td>
            <td class="metric-label" colspan="2">Margem media bruta</td>
            <td class="metric-value percent" colspan="4">${formatExcelNumber(margemMedia / 100)}</td>
          </tr>
          <tr>
            <td class="metric-label" colspan="2">Reposicao sugerida</td>
            <td class="metric-value number">${reposicaoSugerida}</td>
            <td class="muted" colspan="12">Produtos ordenados por maior urgencia operacional.</td>
          </tr>
          <tr><td colspan="15"></td></tr>
          <tr>
            <td class="section" colspan="15">Detalhamento do estoque atual</td>
          </tr>
          <tr>
            <th>ID</th>
            <th>Produto</th>
            <th>Preco de custo</th>
            <th>Preco de venda</th>
            <th>Margem bruta</th>
            <th>% Imposto</th>
            <th>% Taxa</th>
            <th>Estoque atual</th>
            <th>Estoque minimo</th>
            <th>Saldo vs minimo</th>
            <th>Qtd. a repor</th>
            <th>Valor estoque custo</th>
            <th>Venda potencial</th>
            <th>Risco</th>
            <th>Observacao</th>
          </tr>
          ${rows}
        </table>
      </body>
    </html>
  `;
}

function exportarProdutosExcel(produtos) {
  const html = buildProdutosExcelHtml(produtos);
  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-executivo-estoque-${new Date()
    .toISOString()
    .slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportarProdutosCsvFinanceiro(produtos) {
  const headers = [
    "ID",
    "Produto",
    "Preco de Custo",
    "Preco de Venda",
    "Margem Bruta %",
    "Imposto %",
    "Taxa Operacional %",
    "Estoque Atual",
    "Estoque Minimo",
    "Saldo vs Minimo",
    "Qtd. a Repor",
    "Valor Estoque Custo",
    "Venda Potencial",
    "Status",
    "Observacao",
  ];

  const rows = produtos.map((produto) => {
    const estoqueMinimo = produto.estoque_minimo ?? 5;
    const precoCusto = asNumber(produto.preco_custo);
    const precoVenda = asNumber(produto.preco_venda);
    const risco = getReportRisk(produto);

    return [
      produto.id,
      produto.nome,
      formatExcelNumber(precoCusto),
      formatExcelNumber(precoVenda),
      formatExcelNumber(calcularMargemBruta(produto)),
      formatExcelNumber(produto.imposto_percentual),
      formatExcelNumber(produto.taxa_operacional_percentual),
      produto.quantidade_atual,
      estoqueMinimo,
      produto.quantidade_atual - estoqueMinimo,
      Math.max(estoqueMinimo - produto.quantidade_atual, 0),
      formatExcelNumber(precoCusto * produto.quantidade_atual),
      formatExcelNumber(precoVenda * produto.quantidade_atual),
      risco.label,
      risco.note,
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(";"))
    .join("\r\n");
  const blob = new Blob(["\ufeff", csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-financeiro-estoque-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
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
  const [estoqueMinimo, setEstoqueMinimo] = useState("5");
  const [impostoPercentual, setImpostoPercentual] = useState("0");
  const [nome, setNome] = useState("");
  const [precoCusto, setPrecoCusto] = useState("");
  const [precoVenda, setPrecoVenda] = useState("");
  const [qtd, setQtd] = useState("0");
  const [taxaOperacionalPercentual, setTaxaOperacionalPercentual] =
    useState("0");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      await cadastrarProduto({
        nome: nome.trim(),
        preco_custo: parseFloat(precoCusto),
        preco_venda: parseFloat(precoVenda),
        imposto_percentual: parseFloat(impostoPercentual || "0"),
        taxa_operacional_percentual: parseFloat(
          taxaOperacionalPercentual || "0",
        ),
        quantidade_atual: parseInt(qtd, 10),
        estoque_minimo: parseInt(estoqueMinimo, 10),
      });

      setNome("");
      setEstoqueMinimo("5");
      setImpostoPercentual("0");
      setPrecoCusto("");
      setPrecoVenda("");
      setQtd("0");
      setTaxaOperacionalPercentual("0");
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

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block" htmlFor="produto-preco-custo">
            <span className="text-sm font-medium text-slate-700">
              Preco de custo
            </span>
            <input
              id="produto-preco-custo"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              type="number"
              step="0.01"
              min="0"
              value={precoCusto}
              onChange={(event) => setPrecoCusto(event.target.value)}
              required
              placeholder="0.00"
            />
          </label>

          <label className="block" htmlFor="produto-preco-venda">
            <span className="text-sm font-medium text-slate-700">
              Preco de venda
            </span>
            <input
              id="produto-preco-venda"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              type="number"
              step="0.01"
              min="0.01"
              value={precoVenda}
              onChange={(event) => setPrecoVenda(event.target.value)}
              required
              placeholder="0.00"
            />
          </label>

          <label className="block" htmlFor="produto-imposto">
            <span className="text-sm font-medium text-slate-700">
              % Imposto
            </span>
            <input
              id="produto-imposto"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              type="number"
              step="0.01"
              min="0"
              value={impostoPercentual}
              onChange={(event) => setImpostoPercentual(event.target.value)}
              required
            />
          </label>

          <label className="block" htmlFor="produto-taxa-operacional">
            <span className="text-sm font-medium text-slate-700">
              % Taxa
            </span>
            <input
              id="produto-taxa-operacional"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              type="number"
              step="0.01"
              min="0"
              value={taxaOperacionalPercentual}
              onChange={(event) =>
                setTaxaOperacionalPercentual(event.target.value)
              }
              required
            />
          </label>
        </div>

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

        <label className="block" htmlFor="produto-estoque-minimo">
          <span className="text-sm font-medium text-slate-700">
            Estoque minimo
          </span>
          <input
            id="produto-estoque-minimo"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            type="number"
            min="0"
            value={estoqueMinimo}
            onChange={(event) => setEstoqueMinimo(event.target.value)}
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
  const [statusVenda, setStatusVenda] = useState("concluido");
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
        status: tipo === "saida" ? statusVenda : "concluido",
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

        {tipo === "saida" && (
          <label className="block" htmlFor="movimentacao-status-venda">
            <span className="text-sm font-medium text-slate-700">
              Status da venda
            </span>
            <select
              id="movimentacao-status-venda"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              value={statusVenda}
              onChange={(event) => setStatusVenda(event.target.value)}
              required
            >
              <option value="orcamento">Orcamento</option>
              <option value="pendente">Aguardando Confirmacao</option>
              <option value="concluido">Concluido</option>
            </select>
          </label>
        )}

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

function DashboardEstoque({ estatisticas, previsoes, produtos }) {
  const previsoesPorProdutoId = useMemo(
    () =>
      new Map(
        previsoes.map((previsao) => [previsao.produto_id, previsao]),
      ),
    [previsoes],
  );
  const topProdutos = useMemo(
    () =>
      [...produtos]
        .sort((a, b) => b.quantidade_atual - a.quantidade_atual)
        .slice(0, 5)
        .map((produto) => ({
          id: produto.id,
          nomeCompleto: produto.nome,
          nome:
            produto.nome.length > 18
              ? `${produto.nome.slice(0, 16)}...`
              : produto.nome,
          quantidade: produto.quantidade_atual,
          precoCusto: asNumber(produto.preco_custo),
          precoVenda: asNumber(produto.preco_venda),
          margemBruta: calcularMargemBruta(produto),
        })),
    [produtos],
  );

  const totalItens = produtos.reduce(
    (total, produto) => total + produto.quantidade_atual,
    0,
  );
  const valorInvestidoEstoque = produtos.reduce(
    (total, produto) =>
      total + asNumber(produto.preco_custo) * produto.quantidade_atual,
    0,
  );
  const produtosBaixos = produtos.filter(
    (produto) => produto.quantidade_atual <= (produto.estoque_minimo ?? 5),
  ).length;
  const kpisComerciais = [
    {
      label: "Total Vendas",
      value: currencyFormatter.format(estatisticas?.total_vendas ?? 0),
      description: `${estatisticas?.qtd_vendas ?? 0} vendas realizadas`,
      classes: "border-blue-200 bg-blue-50 text-blue-700",
    },
    {
      label: "Total Liquido",
      value: currencyFormatter.format(estatisticas?.total_liquido ?? 0),
      description: "Receita menos custos e impostos",
      classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    {
      label: "Orcamentos",
      value: currencyFormatter.format(estatisticas?.total_orcamentos ?? 0),
      description: `${estatisticas?.qtd_orcamentos ?? 0} oportunidades abertas`,
      classes: "border-teal-200 bg-teal-50 text-teal-700",
    },
    {
      label: "Pedidos sem Confirmacao",
      value: estatisticas?.pedidos_sem_confirmacao ?? 0,
      description: "Saidas pendentes travando estoque",
      classes: "border-red-200 bg-red-50 text-red-700",
    },
  ];

  return (
    <div className="grid gap-5">
      <section
        aria-label="Indicadores comerciais"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {kpisComerciais.map((kpi) => (
          <div
            className={`rounded-lg border p-5 shadow-sm ${kpi.classes}`}
            key={kpi.label}
          >
            <p className="text-xs font-semibold uppercase tracking-wide">
              {kpi.label}
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {kpi.value}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-600">
              {kpi.description}
            </p>
          </div>
        ))}
      </section>

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

          {topProdutos.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Produto
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Estoque
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Preco de custo
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Preco de venda
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Margem bruta
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Previsao de esgotamento
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topProdutos.map((produto) => (
                    <tr
                      className="transition hover:bg-slate-50"
                      key={produto.id}
                    >
                      <td className="min-w-52 px-3 py-3 text-sm font-semibold text-slate-950">
                        {produto.nomeCompleto}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-950">
                        {produto.quantidade}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                        {currencyFormatter.format(produto.precoCusto)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                        {currencyFormatter.format(produto.precoVenda)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-emerald-700">
                        {formatPercent(produto.margemBruta)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                        {formatarPrevisao(previsoesPorProdutoId.get(produto.id))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Patrimonio / estoque
            </p>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Valor investido parado
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {currencyFormatter.format(valorInvestidoEstoque)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {produtos.length} produtos cadastrados
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">
              Itens em estoque
            </p>
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
        </aside>
      </section>
    </div>
  );
}

function TabelaProdutos({ isAdmin, produtos, onDelete, onEdit }) {
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

  function handleExportExcel() {
    if (produtos.length === 0) {
      toast.error("Nao ha produtos para exportar.");
      return;
    }

    exportarProdutosExcel(produtos);
    toast.success("Relatorio Excel exportado.");
  }

  function handleExportCsv() {
    if (produtos.length === 0) {
      toast.error("Nao ha produtos para exportar.");
      return;
    }

    exportarProdutosCsvFinanceiro(produtos);
    toast.success("CSV financeiro exportado.");
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <CardTitle eyebrow="Inventario" title="Estoque atual" />

        <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              onClick={handleExportExcel}
              disabled={produtos.length === 0}
            >
              Exportar Excel
            </button>
            <button
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              onClick={handleExportCsv}
              disabled={produtos.length === 0}
            >
              Exportar CSV
            </button>
          </div>

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
                  Custo
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Venda
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Margem
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Estoque
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>
                {isAdmin && (
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Acoes
                  </th>
                )}
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
                      {currencyFormatter.format(produto.preco_custo)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                      {currencyFormatter.format(produto.preco_venda)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-emerald-700">
                      {formatPercent(calcularMargemBruta(produto))}
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
                    {isAdmin && (
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
                    )}
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
  const totais = useMemo(
    () =>
      movimentacoes.reduce(
        (acc, movimentacao) => ({
          valorBruto: acc.valorBruto + asNumber(movimentacao.valor_bruto_total),
          impostos:
            acc.impostos + asNumber(movimentacao.valor_impostos_total),
          lucroLiquido:
            acc.lucroLiquido + asNumber(movimentacao.lucro_liquido),
        }),
        { valorBruto: 0, impostos: 0, lucroLiquido: 0 },
      ),
    [movimentacoes],
  );

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      id="historico"
    >
      <CardTitle eyebrow="Auditoria" title="Historico de movimentacoes" />

      {movimentacoes.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Valor bruto
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-950">
              {currencyFormatter.format(totais.valorBruto)}
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Impostos e taxas
            </p>
            <p className="mt-1 text-xl font-semibold text-amber-700">
              {currencyFormatter.format(totais.impostos)}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Lucro liquido
            </p>
            <p className="mt-1 text-xl font-semibold text-emerald-700">
              {currencyFormatter.format(totais.lucroLiquido)}
            </p>
          </div>
        </div>
      )}

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
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Quantidade
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Bruto
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Impostos
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Lucro liquido
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
                  <td className="whitespace-nowrap px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${getVendaStatusClasses(
                        movimentacao.status,
                      )}`}
                    >
                      {getVendaStatusLabel(movimentacao.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-950">
                    {movimentacao.quantidade}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700">
                    {currencyFormatter.format(
                      movimentacao.valor_bruto_total ?? 0,
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-amber-700">
                    {currencyFormatter.format(
                      movimentacao.valor_impostos_total ?? 0,
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-emerald-700">
                    {currencyFormatter.format(movimentacao.lucro_liquido ?? 0)}
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
  const [estoqueMinimo, setEstoqueMinimo] = useState(
    String(produto.estoque_minimo ?? 5),
  );
  const [impostoPercentual, setImpostoPercentual] = useState(
    String(produto.imposto_percentual ?? 0),
  );
  const [nome, setNome] = useState(produto.nome);
  const [precoCusto, setPrecoCusto] = useState(
    String(produto.preco_custo ?? 0),
  );
  const [precoVenda, setPrecoVenda] = useState(
    String(produto.preco_venda ?? 0),
  );
  const [taxaOperacionalPercentual, setTaxaOperacionalPercentual] = useState(
    String(produto.taxa_operacional_percentual ?? 0),
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      await editarProduto(produto.id, {
        nome: nome.trim(),
        preco_custo: parseFloat(precoCusto),
        preco_venda: parseFloat(precoVenda),
        imposto_percentual: parseFloat(impostoPercentual || "0"),
        taxa_operacional_percentual: parseFloat(
          taxaOperacionalPercentual || "0",
        ),
        estoque_minimo: parseInt(estoqueMinimo, 10),
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
        className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
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

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="editar-produto-preco-custo">
              <span className="text-sm font-medium text-slate-700">
                Preco de custo
              </span>
              <input
                id="editar-produto-preco-custo"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                type="number"
                step="0.01"
                min="0"
                value={precoCusto}
                onChange={(event) => setPrecoCusto(event.target.value)}
                required
              />
            </label>

            <label className="block" htmlFor="editar-produto-preco-venda">
              <span className="text-sm font-medium text-slate-700">
                Preco de venda
              </span>
              <input
                id="editar-produto-preco-venda"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                type="number"
                step="0.01"
                min="0.01"
                value={precoVenda}
                onChange={(event) => setPrecoVenda(event.target.value)}
                required
              />
            </label>

            <label className="block" htmlFor="editar-produto-imposto">
              <span className="text-sm font-medium text-slate-700">
                % Imposto
              </span>
              <input
                id="editar-produto-imposto"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                type="number"
                step="0.01"
                min="0"
                value={impostoPercentual}
                onChange={(event) => setImpostoPercentual(event.target.value)}
                required
              />
            </label>

            <label className="block" htmlFor="editar-produto-taxa-operacional">
              <span className="text-sm font-medium text-slate-700">
                % Taxa
              </span>
              <input
                id="editar-produto-taxa-operacional"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                type="number"
                step="0.01"
                min="0"
                value={taxaOperacionalPercentual}
                onChange={(event) =>
                  setTaxaOperacionalPercentual(event.target.value)
                }
                required
              />
            </label>
          </div>

          <label className="block" htmlFor="editar-produto-estoque-minimo">
            <span className="text-sm font-medium text-slate-700">
              Estoque minimo
            </span>
            <input
              id="editar-produto-estoque-minimo"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              type="number"
              min="0"
              value={estoqueMinimo}
              onChange={(event) => setEstoqueMinimo(event.target.value)}
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

function AssistenteIAModal({ onClose, onSaved }) {
  const dialogRef = useDialogFocusTrap(onClose);
  const [loading, setLoading] = useState(false);
  const [texto, setTexto] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      const data = await registrarMovimentacaoTexto({ texto: texto.trim() });
      toast.success(
        `Movimentacao ${data.tipo} registrada para ${data.produto_nome}.`,
      );
      setTexto("");
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message || "Nao foi possivel executar o comando IA.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 px-4">
      <form
        aria-labelledby="assistente-ia-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
        onSubmit={handleSubmit}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <CardTitle
          eyebrow="Assistente IA"
          title="Comando de Voz/Texto"
          titleId="assistente-ia-title"
        />

        <label className="block" htmlFor="assistente-ia-texto">
          <span className="text-sm font-medium text-slate-700">
            Descreva a movimentacao
          </span>
          <textarea
            id="assistente-ia-texto"
            className="mt-1 min-h-32 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            required
            placeholder="Ex: Chegaram 20 unidades do mouse"
          />
        </label>

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
            className="inline-flex items-center justify-center rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={loading}
          >
            {loading ? <LoadingLabel text="Executando..." /> : "Executar"}
          </button>
        </div>
      </form>
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

function AlertasButton({ alertas }) {
  const [isOpen, setIsOpen] = useState(false);
  const alertasCount = alertas.length;

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-label={`Alertas de estoque: ${alertasCount}`}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-cyan-100"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {alertasCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {alertasCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <p className="text-sm font-semibold text-slate-950">
            Alertas de estoque
          </p>
          {alertasCount === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Nenhum alerta pendente.
            </p>
          ) : (
            <ul className="mt-3 grid max-h-72 gap-3 overflow-y-auto">
              {alertas.map((alerta) => (
                <li
                  className="rounded-md border border-red-100 bg-red-50 px-3 py-2"
                  key={alerta.id}
                >
                  <p className="text-sm font-semibold text-red-700">
                    {alerta.produto_nome}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-red-700">
                    {alerta.mensagem}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AppHeader({ alertas, isAdmin, onLogout, onOpenAssistant, user }) {
  const visibleNavItems = navItems.filter(
    (item) => item.to !== "/historico" || isAdmin,
  );

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
          {visibleNavItems.map((item) => (
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
            className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-cyan-700 transition hover:bg-cyan-100 focus:outline-none focus:ring-4 focus:ring-cyan-100"
            type="button"
            onClick={onOpenAssistant}
          >
            <Bot className="h-4 w-4" aria-hidden="true" />
            Comando IA
          </button>
          <AlertasButton alertas={alertas} />
          {user && (
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
              {user.username} - {formatRole(user.role)}
            </span>
          )}
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

function DashboardPage({ estatisticas, previsoes, produtos }) {
  return (
    <DashboardEstoque
      estatisticas={estatisticas}
      previsoes={previsoes}
      produtos={produtos}
    />
  );
}

function ProdutosPage({ isAdmin, onDelete, onEdit, onSaved, produtos }) {
  return (
    <div
      className={`grid gap-6 ${
        isAdmin ? "xl:grid-cols-[360px_1fr] xl:items-start" : ""
      }`}
    >
      {isAdmin && <FormProduto onSaved={onSaved} />}
      <TabelaProdutos
        isAdmin={isAdmin}
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
  estatisticasDashboard,
  isAdmin,
  isLoadingDados,
  movimentacoes,
  onDeleteProduto,
  onEditProduto,
  onSaved,
  previsoes,
  produtos,
}) {
  return (
    <PageLayout erroGlobal={erroGlobal} isLoadingDados={isLoadingDados}>
      <Routes>
        <Route
          path="/"
          element={
            <DashboardPage
              estatisticas={estatisticasDashboard}
              previsoes={previsoes}
              produtos={produtos}
            />
          }
        />
        <Route
          path="/produtos"
          element={
            <ProdutosPage
              isAdmin={isAdmin}
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
          element={
            isAdmin ? (
              <HistoricoPage movimentacoes={movimentacoes} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PageLayout>
  );
}

export default function App() {
  const [authToken, setAuthTokenState] = useState(() => getAuthToken());
  const [alertas, setAlertas] = useState([]);
  const [assistenteAberto, setAssistenteAberto] = useState(false);
  const [erroGlobal, setErroGlobal] = useState("");
  const [estatisticasDashboard, setEstatisticasDashboard] = useState(null);
  const [isLoadingDados, setIsLoadingDados] = useState(false);
  const [movimentacoes, setMovimentacoes] = useState([]);
  const [previsoes, setPrevisoes] = useState([]);
  const [produtoEditando, setProdutoEditando] = useState(null);
  const [produtoExcluindo, setProdutoExcluindo] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const authUser = useMemo(() => decodeAuthToken(authToken), [authToken]);
  const isAdmin = authUser?.role === "admin";

  const handleLogout = useCallback(() => {
    clearAuthToken();
    setAuthTokenState(null);
    setAlertas([]);
    setProdutos([]);
    setPrevisoes([]);
    setEstatisticasDashboard(null);
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
      const requests = [
        listarProdutos(),
        listarAlertas(),
        listarPrevisaoRuptura(),
        obterEstatisticasDashboard(),
      ];

      if (isAdmin) {
        requests.push(listarMovimentacoes());
      }

      const [
        produtosData,
        alertasData,
        previsoesData,
        estatisticasData,
        movimentacoesData,
      ] = await Promise.all(requests);

      setProdutos(produtosData);
      setAlertas(alertasData);
      setPrevisoes(previsoesData);
      setEstatisticasDashboard(estatisticasData);
      setMovimentacoes(isAdmin ? movimentacoesData : []);
      setErroGlobal("");
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        handleLogout();
        toast.error("Sessao expirada. Faca login novamente.");
        return;
      }

      const message =
        "Nao foi possivel conectar ao backend em http://127.0.0.1:8000.";
      setErroGlobal(message);
      toast.error(message, { id: "backend-offline" });
    } finally {
      setIsLoadingDados(false);
    }
  }, [authToken, handleLogout, isAdmin]);

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
        <AppHeader
          alertas={alertas}
          isAdmin={isAdmin}
          onLogout={handleLogout}
          onOpenAssistant={() => setAssistenteAberto(true)}
          user={authUser}
        />

        <AppRoutes
          erroGlobal={erroGlobal}
          estatisticasDashboard={estatisticasDashboard}
          isAdmin={isAdmin}
          isLoadingDados={isLoadingDados}
          movimentacoes={movimentacoes}
          onDeleteProduto={setProdutoExcluindo}
          onEditProduto={setProdutoEditando}
          onSaved={carregar}
          previsoes={previsoes}
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

        {assistenteAberto && (
          <AssistenteIAModal
            onClose={() => setAssistenteAberto(false)}
            onSaved={carregar}
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
