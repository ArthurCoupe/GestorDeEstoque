import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Bell,
  Bot,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mic,
  MicOff,
  Moon,
  Sun,
} from "lucide-react";
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

function getInitialTheme() {
  if (typeof window === "undefined") {
    return "light";
  }

  const savedTheme = window.localStorage.getItem("theme");

  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) =>
      currentTheme === "dark" ? "light" : "dark",
    );
  }, []);

  return { isDarkMode: theme === "dark", theme, toggleTheme };
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
    return "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-900";
  }

  if (statusVenda === "pendente") {
    return "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900";
  }

  return "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900";
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
      classes:
        "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900",
    };
  }

  if (produto.quantidade_atual <= estoqueMinimo) {
    return {
      label: "Baixo",
      classes:
        "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900",
    };
  }

  return {
    label: "OK",
    classes:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900",
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

function getReportGeneratedAt() {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

function getMovimentacaoReportPeriod(movimentacoes) {
  const datas = movimentacoes
    .map((movimentacao) => new Date(movimentacao.data_hora?.replace(" ", "T")))
    .filter((data) => !Number.isNaN(data.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (datas.length === 0) {
    return "Registros visiveis na tabela";
  }

  const formatador = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return `${formatador.format(datas[0])} ate ${formatador.format(
    datas[datas.length - 1],
  )}`;
}

function getMovimentacoesReportRows(movimentacoes) {
  return movimentacoes.map((movimentacao) => ({
    dataHora: formatDate(movimentacao.data_hora),
    produto: movimentacao.produto_nome,
    tipo: movimentacao.tipo === "entrada" ? "Entrada" : "Saida",
    status: getVendaStatusLabel(movimentacao.status),
    quantidade: asNumber(movimentacao.quantidade),
    valorBruto: asNumber(movimentacao.valor_bruto_total),
    valorCusto: asNumber(movimentacao.valor_custo_total),
    impostos: asNumber(movimentacao.valor_impostos_total),
    lucroLiquido: asNumber(movimentacao.lucro_liquido),
    usuario: movimentacao.usuario_username ?? "-",
  }));
}

function getMovimentacoesReportSummary(movimentacoes) {
  return movimentacoes.reduce(
    (summary, movimentacao) => {
      const quantidade = asNumber(movimentacao.quantidade);

      if (movimentacao.tipo === "entrada") {
        summary.totalEntradas += quantidade;
      }

      if (movimentacao.tipo === "saida") {
        summary.totalSaidas += asNumber(movimentacao.valor_bruto_total);
      }

      summary.lucroLiquido += asNumber(movimentacao.lucro_liquido);
      return summary;
    },
    { totalEntradas: 0, totalSaidas: 0, lucroLiquido: 0 },
  );
}

async function exportarHistoricoExcel(movimentacoes) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GestorDeEstoque";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Relatorio Financeiro", {
    views: [{ showGridLines: false }],
  });
  const generatedAt = getReportGeneratedAt();
  const periodo = getMovimentacaoReportPeriod(movimentacoes);
  const summary = getMovimentacoesReportSummary(movimentacoes);
  const rows = getMovimentacoesReportRows(movimentacoes);
  const reportColumns = [
    { header: "Data/Hora", key: "dataHora", width: 18 },
    { header: "Produto", key: "produto", width: 28 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Status", key: "status", width: 24 },
    { header: "Qtd", key: "quantidade", width: 10 },
    { header: "Valor Bruto", key: "valorBruto", width: 16 },
    { header: "Valor Custo", key: "valorCusto", width: 16 },
    { header: "Impostos/Taxas", key: "impostos", width: 18 },
    { header: "Lucro Liquido", key: "lucroLiquido", width: 18 },
    { header: "Usuario", key: "usuario", width: 18 },
  ];

  worksheet.mergeCells("A1:J1");
  worksheet.getCell("A1").value =
    "GESTOR DE ESTOQUE - RELATORIO FINANCEIRO";
  worksheet.getCell("A1").font = {
    bold: true,
    color: { argb: "FF0F172A" },
    size: 16,
  };
  worksheet.getCell("A1").alignment = { horizontal: "left" };

  worksheet.mergeCells("A2:J2");
  worksheet.getCell("A2").value = `Gerado em ${generatedAt} | Periodo: ${periodo}`;
  worksheet.getCell("A2").font = { color: { argb: "FF64748B" }, size: 11 };

  const summaryStartRow = 4;
  const summaryCells = [
    ["A", "Total de Entradas", summary.totalEntradas, "#,##0"],
    ["D", "Total de Saidas", summary.totalSaidas, '"R$" #,##0.00'],
    ["G", "Lucro Liquido", summary.lucroLiquido, '"R$" #,##0.00'],
  ];

  summaryCells.forEach(([column, label, value, numberFormat]) => {
    const labelCell = worksheet.getCell(`${column}${summaryStartRow}`);
    const valueCell = worksheet.getCell(`${column}${summaryStartRow + 1}`);
    labelCell.value = label;
    valueCell.value = value;
    valueCell.numFmt = numberFormat;

    [labelCell, valueCell].forEach((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });

    labelCell.font = { bold: true, color: { argb: "FF475569" } };
    valueCell.font = { bold: true, color: { argb: "FF0F172A" }, size: 14 };
  });

  worksheet.columns = reportColumns.map(({ key, width }) => ({ key, width }));
  const headerRowNumber = 7;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = reportColumns.map((column) => column.header);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A8A" },
    };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FF1E40AF" } },
      left: { style: "thin", color: { argb: "FF1E40AF" } },
      bottom: { style: "thin", color: { argb: "FF1E40AF" } },
      right: { style: "thin", color: { argb: "FF1E40AF" } },
    };
  });

  rows.forEach((row, index) => {
    const worksheetRow = worksheet.addRow(row);
    const isEven = index % 2 === 1;

    worksheetRow.eachCell((cell, columnNumber) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? "FFF3F4F6" : "FFFFFFFF" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
      cell.alignment = {
        horizontal: columnNumber >= 5 ? "right" : "left",
        vertical: "middle",
      };

      if (columnNumber >= 6 && columnNumber <= 9) {
        cell.numFmt = '"R$" #,##0.00';
      }
    });
  });

  worksheet.columns.forEach((column) => {
    let maxLength = column.header?.length ?? 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const length = value == null ? 0 : String(value).length;
      maxLength = Math.max(maxLength, length);
    });
    column.width = Math.min(Math.max(maxLength + 2, column.width ?? 12), 32);
  });

  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber + rows.length, column: reportColumns.length },
  };
  worksheet.views = [
    { state: "frozen", ySplit: headerRowNumber, showGridLines: false },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `relatorio-financeiro-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

function exportarHistoricoPdf(movimentacoes) {
  const doc = new jsPDF({
    format: "a4",
    orientation: "landscape",
    unit: "pt",
  });
  const generatedAt = getReportGeneratedAt();
  const periodo = getMovimentacaoReportPeriod(movimentacoes);
  const summary = getMovimentacoesReportSummary(movimentacoes);
  const rows = getMovimentacoesReportRows(movimentacoes);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("GESTOR DE ESTOQUE - RELATORIO FINANCEIRO", 40, 42);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Gerado em ${generatedAt} | Periodo: ${periodo}`, 40, 60);

  const kpiY = 84;
  const kpis = [
    ["Total de Entradas", `${summary.totalEntradas}`],
    ["Total de Saidas", currencyFormatter.format(summary.totalSaidas)],
    ["Lucro Liquido", currencyFormatter.format(summary.lucroLiquido)],
  ];

  kpis.forEach(([label, value], index) => {
    const x = 40 + index * 220;
    doc.setFillColor(243, 244, 246);
    doc.setDrawColor(229, 231, 235);
    doc.roundedRect(x, kpiY, 190, 48, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(label.toUpperCase(), x + 12, kpiY + 17);
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 12, kpiY + 36);
  });

  autoTable(doc, {
    startY: 154,
    theme: "grid",
    head: [
      [
        "Data/Hora",
        "Produto",
        "Tipo",
        "Status",
        "Qtd",
        "Bruto",
        "Custo",
        "Impostos",
        "Lucro",
        "Usuario",
      ],
    ],
    body: rows.map((row) => [
      row.dataHora,
      row.produto,
      row.tipo,
      row.status,
      row.quantidade,
      currencyFormatter.format(row.valorBruto),
      currencyFormatter.format(row.valorCusto),
      currencyFormatter.format(row.impostos),
      currencyFormatter.format(row.lucroLiquido),
      row.usuario,
    ]),
    headStyles: {
      fillColor: [30, 58, 138],
      halign: "center",
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    styles: {
      cellPadding: 5,
      fontSize: 8,
      lineColor: [229, 231, 235],
      lineWidth: 0.5,
      overflow: "linebreak",
      valign: "middle",
    },
    alternateRowStyles: {
      fillColor: [243, 244, 246],
    },
    columnStyles: {
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
    },
    margin: { left: 40, right: 40 },
  });

  doc.save(`relatorio-financeiro-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function CardTitle({ eyebrow, title, titleId }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </p>
      <h2
        className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100"
        id={titleId}
      >
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
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      onSubmit={handleSubmit}
    >
      <CardTitle eyebrow="Cadastro" title="Novo produto" />

      <div className="space-y-4">
        <label className="block" htmlFor="produto-nome">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Nome</span>
          <input
            id="produto-nome"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            required
            placeholder="Ex: Camiseta azul"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block" htmlFor="produto-preco-custo">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Preco de custo
            </span>
            <input
              id="produto-preco-custo"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Preco de venda
            </span>
            <input
              id="produto-preco-venda"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              % Imposto
            </span>
            <input
              id="produto-imposto"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
              type="number"
              step="0.01"
              min="0"
              value={impostoPercentual}
              onChange={(event) => setImpostoPercentual(event.target.value)}
              required
            />
          </label>

          <label className="block" htmlFor="produto-taxa-operacional">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              % Taxa
            </span>
            <input
              id="produto-taxa-operacional"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Quantidade inicial
          </span>
          <input
            id="produto-quantidade"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
            type="number"
            min="0"
            value={qtd}
            onChange={(event) => setQtd(event.target.value)}
            required
          />
        </label>

        <label className="block" htmlFor="produto-estoque-minimo">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Estoque minimo
          </span>
          <input
            id="produto-estoque-minimo"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      onSubmit={handleSubmit}
    >
      <CardTitle eyebrow="Estoque" title="Movimentacao" />

      <div className="space-y-4">
        <label className="block" htmlFor="movimentacao-produto">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Produto</span>
          <select
            id="movimentacao-produto"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
          <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Tipo</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition focus-within:ring-4 focus-within:ring-emerald-100 ${
                tipo === "entrada"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-500"
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
                  ? "border-red-500 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-950/50 dark:text-red-300"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-500"
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Status da venda
            </span>
            <select
              id="movimentacao-status-venda"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Quantidade</span>
          <input
            id="movimentacao-quantidade"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
            type="number"
            min="1"
            value={qtd}
            onChange={(event) => setQtd(event.target.value)}
            required
            placeholder="0"
          />
        </label>

        <button
          className="inline-flex w-full items-center justify-center rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-600 dark:text-slate-950 dark:hover:bg-cyan-500 dark:focus:ring-cyan-900/60"
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

function DashboardEstoque({
  estatisticas,
  isAdmin,
  isDarkMode,
  previsoes,
  produtos,
}) {
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
  const chartGridColor = isDarkMode ? "#334155" : "#e2e8f0";
  const chartTextColor = isDarkMode ? "#cbd5e1" : "#475569";
  const chartAxisColor = isDarkMode ? "#475569" : "#cbd5e1";
  const chartTooltipStyle = {
    background: isDarkMode ? "#0f172a" : "#ffffff",
    border: `1px solid ${isDarkMode ? "#334155" : "#e2e8f0"}`,
    borderRadius: "8px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.18)",
    color: isDarkMode ? "#f8fafc" : "#0f172a",
  };
  const kpisComerciais = [
    {
      label: "Total Vendas",
      value: currencyFormatter.format(estatisticas?.total_vendas ?? 0),
      description: `${estatisticas?.qtd_vendas ?? 0} vendas realizadas`,
      classes:
        "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300",
    },
    {
      label: "Total Liquido",
      value: currencyFormatter.format(estatisticas?.total_liquido ?? 0),
      description: "Receita menos custos e impostos",
      classes:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    {
      label: "Orcamentos",
      value: currencyFormatter.format(estatisticas?.total_orcamentos ?? 0),
      description: `${estatisticas?.qtd_orcamentos ?? 0} oportunidades abertas`,
      classes:
        "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-300",
    },
    {
      label: "Pedidos sem Confirmacao",
      value: estatisticas?.pedidos_sem_confirmacao ?? 0,
      description: "Saidas pendentes travando estoque",
      classes:
        "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
    },
  ];

  return (
    <div className="grid gap-5">
      {isAdmin && (
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
              <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-100">
                {kpi.value}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-400">
                {kpi.description}
              </p>
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <CardTitle eyebrow="Dashboard" title="Top 5 produtos em estoque" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ordenado por quantidade atual
            </p>
          </div>

          <div className="h-72">
            {topProdutos.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProdutos} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis
                    dataKey="nome"
                    tick={{ fill: chartTextColor, fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: chartAxisColor }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: chartTextColor, fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: chartAxisColor }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(14, 165, 233, 0.08)" }}
                    contentStyle={chartTooltipStyle}
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
              <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                Cadastre produtos para visualizar o ranking.
              </div>
            )}
          </div>

          {isAdmin && topProdutos.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Produto
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Estoque
                    </th>
                    {isAdmin && (
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Preco de custo
                      </th>
                    )}
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Preco de venda
                    </th>
                    {isAdmin && (
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Margem bruta
                      </th>
                    )}
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Previsao de esgotamento
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {topProdutos.map((produto) => (
                    <tr
                      className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      key={produto.id}
                    >
                      <td className="min-w-52 px-3 py-3 text-sm font-semibold text-slate-950 dark:text-slate-100">
                        {produto.nomeCompleto}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-950 dark:text-slate-100">
                        {produto.quantidade}
                      </td>
                      {isAdmin && (
                        <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700 dark:text-slate-300">
                          {currencyFormatter.format(produto.precoCusto)}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700 dark:text-slate-300">
                        {currencyFormatter.format(produto.precoVenda)}
                      </td>
                      {isAdmin && (
                        <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-emerald-700">
                          {formatPercent(produto.margemBruta)}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700 dark:text-slate-300">
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
          {isAdmin && (
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Patrimonio / estoque
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                Valor investido parado
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-100">
                {currencyFormatter.format(valorInvestidoEstoque)}
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {produtos.length} produtos cadastrados
              </p>
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Itens em estoque
            </p>
            <p className="mt-2 text-3xl font-semibold text-cyan-700">
              {totalItens}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Atencao</p>
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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <CardTitle eyebrow="Inventario" title="Estoque atual" />

        <div className="w-full lg:max-w-xl">
          <label className="w-full">
            <span className="sr-only">Buscar produto</span>
            <span className="sr-only" id="busca-produto-ajuda">
              Busca indexada em memoria por nome e prefixos dos produtos.
            </span>
            <input
              aria-describedby="busca-produto-ajuda"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome..."
            />
          </label>
        </div>
      </div>

      <div className="mt-1 overflow-x-auto">
        {produtos.length === 0 ? (
          <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            Nenhum produto cadastrado ainda.
          </div>
        ) : produtosFiltrados.length === 0 ? (
          <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            Nenhum produto encontrado para a busca informada.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead>
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  ID
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Produto
                </th>
                {isAdmin && (
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Custo
                  </th>
                )}
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Venda
                </th>
                {isAdmin && (
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Margem
                  </th>
                )}
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Estoque
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Status
                </th>
                {isAdmin && (
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Acoes
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {produtosFiltrados.map((produto) => {
                const status = getStatus(produto);

                return (
                  <tr
                    className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    key={produto.id}
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                      #{produto.id}
                    </td>
                    <td className="min-w-52 px-3 py-3 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {produto.nome}
                    </td>
                    {isAdmin && (
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700 dark:text-slate-300">
                        {currencyFormatter.format(produto.preco_custo)}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700 dark:text-slate-300">
                      {currencyFormatter.format(produto.preco_venda)}
                    </td>
                    {isAdmin && (
                      <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-emerald-700">
                        {formatPercent(calcularMargemBruta(produto))}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-950 dark:text-slate-100">
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
                            className="rounded-md border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-100 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-300 dark:hover:bg-cyan-900/50 dark:focus:ring-cyan-900/60"
                            type="button"
                            onClick={() => onEdit(produto)}
                          >
                            Editar
                          </button>
                          <button
                            className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 dark:focus:ring-red-900/60"
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
  const [exportando, setExportando] = useState("");
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

  async function handleExportExcel() {
    if (movimentacoes.length === 0) {
      toast.error("Nao ha movimentacoes para exportar.");
      return;
    }

    setExportando("excel");
    try {
      await exportarHistoricoExcel(movimentacoes);
      toast.success("Relatorio Excel exportado.");
    } catch (err) {
      toast.error(err.message || "Nao foi possivel gerar o Excel.");
    } finally {
      setExportando("");
    }
  }

  function handleExportPdf() {
    if (movimentacoes.length === 0) {
      toast.error("Nao ha movimentacoes para exportar.");
      return;
    }

    setExportando("pdf");
    try {
      exportarHistoricoPdf(movimentacoes);
      toast.success("Relatorio PDF exportado.");
    } catch (err) {
      toast.error(err.message || "Nao foi possivel gerar o PDF.");
    } finally {
      setExportando("");
    }
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      id="historico"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <CardTitle eyebrow="Auditoria" title="Historico de movimentacoes" />

        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50 dark:focus:ring-emerald-900/60"
            type="button"
            onClick={handleExportExcel}
            disabled={movimentacoes.length === 0 || Boolean(exportando)}
          >
            {exportando === "excel" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            )}
            Exportar Excel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 dark:focus:ring-red-900/60"
            type="button"
            onClick={handleExportPdf}
            disabled={movimentacoes.length === 0 || Boolean(exportando)}
          >
            {exportando === "pdf" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            Exportar PDF
          </button>
        </div>
      </div>

      {movimentacoes.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Valor bruto
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-100">
              {currencyFormatter.format(totais.valorBruto)}
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Impostos e taxas
            </p>
            <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-300">
              {currencyFormatter.format(totais.impostos)}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Lucro liquido
            </p>
            <p className="mt-1 text-xl font-semibold text-emerald-700 dark:text-emerald-300">
              {currencyFormatter.format(totais.lucroLiquido)}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        {movimentacoes.length === 0 ? (
          <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            Nenhuma movimentacao registrada ainda.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead>
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Data/Hora
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Produto
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Tipo
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Quantidade
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Bruto
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Impostos
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Lucro liquido
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {movimentacoes.map((movimentacao) => (
                <tr
                  className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  key={movimentacao.id}
                >
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-600 dark:text-slate-400">
                    {formatDate(movimentacao.data_hora)}
                  </td>
                  <td className="min-w-52 px-3 py-3 text-sm font-semibold text-slate-950 dark:text-slate-100">
                    {movimentacao.produto_nome}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                        movimentacao.tipo === "entrada"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900"
                          : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900"
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
                  <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-slate-950 dark:text-slate-100">
                    {movimentacao.quantidade}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-700 dark:text-slate-300">
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
        className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Nome</span>
            <input
              id="editar-produto-nome"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              required
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="editar-produto-preco-custo">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Preco de custo
              </span>
              <input
                id="editar-produto-preco-custo"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
                type="number"
                step="0.01"
                min="0"
                value={precoCusto}
                onChange={(event) => setPrecoCusto(event.target.value)}
                required
              />
            </label>

            <label className="block" htmlFor="editar-produto-preco-venda">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Preco de venda
              </span>
              <input
                id="editar-produto-preco-venda"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
                type="number"
                step="0.01"
                min="0.01"
                value={precoVenda}
                onChange={(event) => setPrecoVenda(event.target.value)}
                required
              />
            </label>

            <label className="block" htmlFor="editar-produto-imposto">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                % Imposto
              </span>
              <input
                id="editar-produto-imposto"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
                type="number"
                step="0.01"
                min="0"
                value={impostoPercentual}
                onChange={(event) => setImpostoPercentual(event.target.value)}
                required
              />
            </label>

            <label className="block" htmlFor="editar-produto-taxa-operacional">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                % Taxa
              </span>
              <input
                id="editar-produto-taxa-operacional"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Estoque minimo
            </span>
            <input
              id="editar-produto-estoque-minimo"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
              type="number"
              min="0"
              value={estoqueMinimo}
              onChange={(event) => setEstoqueMinimo(event.target.value)}
              required
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-cyan-900/60"
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
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <CardTitle
          eyebrow="Exclusao"
          title="Excluir produto"
          titleId="excluir-produto-title"
        />
        <p className="text-sm text-slate-600 dark:text-slate-400" id="excluir-produto-descricao">
          Esta acao remove o produto{" "}
          <span className="font-semibold text-slate-950 dark:text-slate-100">{produto.nome}</span> e
          suas movimentacoes vinculadas.
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-cyan-900/60"
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
  const [isListening, setIsListening] = useState(false);
  const [texto, setTexto] = useState("");
  const recognitionRef = useRef(null);
  const speechTimeoutRef = useRef(null);
  const speechResultRef = useRef(false);
  const speechErrorRef = useRef(false);
  const speechSuccessToastRef = useRef(false);
  const stopRequestedRef = useRef(false);

  function clearSpeechTimeout() {
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
  }

  function stopVoiceRecognition() {
    stopRequestedRef.current = true;
    clearSpeechTimeout();
    setIsListening(false);

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }

  async function ensureMicrophoneAccess() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err) {
      speechErrorRef.current = true;

      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        toast.error("Permissao do microfone negada pelo navegador.");
        return false;
      }

      if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
        toast.error("Nenhum microfone foi encontrado neste dispositivo.");
        return false;
      }

      toast.error("Nao foi possivel acessar o microfone.");
      return false;
    }
  }

  async function handleVoiceToggle() {
    if (isListening) {
      stopVoiceRecognition();
      return;
    }

    const SpeechRecognition =
      typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!SpeechRecognition) {
      toast.error("Seu navegador nao suporta reconhecimento de voz.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    speechResultRef.current = false;
    speechErrorRef.current = false;
    speechSuccessToastRef.current = false;
    stopRequestedRef.current = false;

    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      const resultados = Array.from(event.results ?? []);
      const transcript = resultados
        .map((result) => result?.[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const hasFinalResult = resultados.some((result) => result.isFinal);

      if (!transcript) {
        return;
      }

      speechResultRef.current = true;
      setTexto(transcript);

      if (hasFinalResult && !speechSuccessToastRef.current) {
        speechSuccessToastRef.current = true;
        toast.success("Texto capturado por voz.");
        recognition.stop();
      }
    };

    recognition.onerror = (event) => {
      speechErrorRef.current = true;
      clearSpeechTimeout();
      setIsListening(false);

      if (event.error === "aborted") {
        return;
      }

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Permissao do microfone negada pelo navegador.");
        return;
      }

      if (event.error === "audio-capture") {
        toast.error("Nao foi possivel acessar o microfone.");
        return;
      }

      if (event.error === "no-speech") {
        toast.error("Nao foi possivel entender o audio. Tente novamente.");
        return;
      }

      if (event.error === "network") {
        toast.error(
          "O servico de voz do navegador ficou indisponivel. Tente novamente no Chrome ou Edge atualizado.",
        );
        return;
      }

      if (event.error === "language-not-supported") {
        toast.error("O navegador nao suporta reconhecimento em portugues.");
        return;
      }

      toast.error("Falha ao reconhecer a voz. Tente novamente.");
    };

    recognition.onend = () => {
      clearSpeechTimeout();
      setIsListening(false);
      recognitionRef.current = null;

      if (
        !speechResultRef.current &&
        !speechErrorRef.current &&
        !stopRequestedRef.current
      ) {
        toast.error("Nao foi possivel entender o audio. Tente novamente.");
      }
    };

    try {
      const hasMicrophoneAccess = await ensureMicrophoneAccess();

      if (!hasMicrophoneAccess) {
        recognitionRef.current = null;
        return;
      }

      recognition.start();
      speechTimeoutRef.current = window.setTimeout(() => {
        if (!speechResultRef.current) {
          speechErrorRef.current = true;
          toast.error("Nao foi possivel entender o audio no tempo limite.");
          recognition.abort();
          return;
        }

        recognition.stop();
      }, 20000);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      toast.error("Nao foi possivel iniciar a gravacao de voz.");
    }
  }

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      clearSpeechTimeout();

      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

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
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Descreva a movimentacao
          </span>
        </label>
        <div className="mt-1 flex items-start gap-2">
          <textarea
            id="assistente-ia-texto"
            className="mt-1 min-h-32 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            required
            placeholder="Ex: Chegaram 20 unidades do mouse"
          />
          <button
            aria-label={
              isListening ? "Parar gravação de voz" : "Iniciar gravação de voz"
            }
            aria-pressed={isListening}
            className={`mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-sm font-semibold transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${
              isListening
                ? "animate-pulse border-red-500 bg-red-600 text-white hover:bg-red-700 focus:ring-red-100 dark:focus:ring-red-900/60"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-cyan-900/60"
            }`}
            disabled={loading}
            onClick={handleVoiceToggle}
            title={isListening ? "Parar gravação" : "Iniciar gravação"}
            type="button"
          >
            {isListening ? (
              <MicOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-cyan-900/60"
            type="button"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800 focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={loading || isListening}
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 transition-colors dark:bg-slate-950">
      <form
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        onSubmit={handleSubmit}
      >
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            GestorDeEstoque
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-100">
            Acessar painel
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Entre com seu usuario para gerenciar o estoque.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block" htmlFor="login-usuario">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Usuario</span>
            <input
              id="login-usuario"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoComplete="username"
            />
          </label>

          <label className="block" htmlFor="login-senha">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Senha</span>
            <input
              id="login-senha"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
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
  return `rounded-md px-3 py-2 transition focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:focus:ring-cyan-900/60 ${
    isActive
      ? "bg-slate-950 text-white dark:bg-cyan-500 dark:text-slate-950"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
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
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus:ring-cyan-900/60"
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
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">
            Alertas de estoque
          </p>
          {alertasCount === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Nenhum alerta pendente.
            </p>
          ) : (
            <ul className="mt-3 grid max-h-72 gap-3 overflow-y-auto">
              {alertas.map((alerta) => (
                <li
                  className="rounded-md border border-red-100 bg-red-50 px-3 py-2 dark:border-red-900/70 dark:bg-red-950/40"
                  key={alerta.id}
                >
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    {alerta.produto_nome}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-red-700 dark:text-red-300">
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

function ThemeToggleButton({ isDarkMode, onToggleTheme }) {
  return (
    <button
      aria-label={
        isDarkMode ? "Ativar modo claro" : "Ativar modo escuro"
      }
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus:ring-cyan-900/60"
      type="button"
      onClick={onToggleTheme}
    >
      {isDarkMode ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

function RoleSwitcher({ role, onRoleChange }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      <span>Visualizar como:</span>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-500 dark:focus:ring-cyan-900/60"
        value={role}
        onChange={(event) => onRoleChange(event.target.value)}
      >
        <option value="admin">Administrador</option>
        <option value="operador">Operador</option>
      </select>
    </label>
  );
}

function AppHeader({
  alertas,
  isAdmin,
  isDarkMode,
  onLogout,
  onOpenAssistant,
  onRoleChange,
  onToggleTheme,
  role,
  user,
}) {
  const visibleNavItems = navItems.filter(
    (item) => item.to !== "/historico" || isAdmin,
  );

  return (
    <header className="border-b border-slate-200 bg-white transition-colors dark:border-slate-800 dark:bg-slate-950">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-cyan-700 focus:shadow dark:focus:bg-slate-900 dark:focus:text-cyan-300"
        href="#conteudo-principal"
      >
        Ir para o conteudo
      </a>

      {!isAdmin && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-semibold text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          Modo de Visualização: Operador (Dados financeiros e ações administrativas ocultos)
        </div>
      )}

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            GestorDeEstoque
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-100">
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
            className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-cyan-700 transition hover:bg-cyan-100 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-300 dark:hover:bg-cyan-900/50 dark:focus:ring-cyan-900/60"
            type="button"
            onClick={onOpenAssistant}
          >
            <Bot className="h-4 w-4" aria-hidden="true" />
            Comando IA
          </button>
          <AlertasButton alertas={alertas} />
          <ThemeToggleButton
            isDarkMode={isDarkMode}
            onToggleTheme={onToggleTheme}
          />
          <RoleSwitcher role={role} onRoleChange={onRoleChange} />
          {user && (
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {user.username} - {formatRole(user.role)}
            </span>
          )}
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus:ring-cyan-900/60"
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
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {erroGlobal}
        </div>
      )}

      {isLoadingDados && (
        <div
          aria-live="polite"
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-700 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-300"
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

function DashboardPage({
  estatisticas,
  isAdmin,
  isDarkMode,
  previsoes,
  produtos,
}) {
  return (
    <DashboardEstoque
      estatisticas={estatisticas}
      isAdmin={isAdmin}
      isDarkMode={isDarkMode}
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
  isDarkMode,
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
              isAdmin={isAdmin}
              isDarkMode={isDarkMode}
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
  const [simulatedRole, setSimulatedRole] = useState("");
  const { isDarkMode, toggleTheme } = useTheme();
  const authUser = useMemo(() => decodeAuthToken(authToken), [authToken]);
  const authRole = authUser?.role ?? "admin";
  const effectiveRole = simulatedRole || authRole;
  const effectiveUser = useMemo(
    () => (authUser ? { ...authUser, role: effectiveRole } : null),
    [authUser, effectiveRole],
  );
  const isAdmin = effectiveRole === "admin";
  const canAccessAdminApi = authRole === "admin";

  const handleLogout = useCallback(() => {
    clearAuthToken();
    setAuthTokenState(null);
    setAlertas([]);
    setProdutos([]);
    setPrevisoes([]);
    setEstatisticasDashboard(null);
    setMovimentacoes([]);
    setSimulatedRole("");
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

      if (isAdmin && canAccessAdminApi) {
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
      setMovimentacoes(isAdmin && canAccessAdminApi ? movimentacoesData : []);
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
  }, [authToken, canAccessAdminApi, handleLogout, isAdmin]);

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

  useEffect(() => {
    setSimulatedRole(authRole);
  }, [authRole]);

  useEffect(() => {
    if (!isAdmin) {
      setProdutoEditando(null);
      setProdutoExcluindo(null);
    }
  }, [isAdmin]);

  if (!authToken) {
    return <LoginPage onLogin={setAuthTokenState} />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-100 text-slate-950 transition-colors dark:bg-slate-950 dark:text-slate-100">
        <AppHeader
          alertas={alertas}
          isAdmin={isAdmin}
          isDarkMode={isDarkMode}
          onLogout={handleLogout}
          onOpenAssistant={() => setAssistenteAberto(true)}
          onRoleChange={setSimulatedRole}
          onToggleTheme={toggleTheme}
          role={effectiveRole}
          user={effectiveUser}
        />

        <AppRoutes
          erroGlobal={erroGlobal}
          estatisticasDashboard={estatisticasDashboard}
          isDarkMode={isDarkMode}
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
