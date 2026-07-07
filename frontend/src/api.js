const API_BASE = "http://localhost:8000";

export async function listarProdutos() {
  const res = await fetch(`${API_BASE}/produtos`);
  if (!res.ok) throw new Error("Erro ao listar produtos");
  return res.json();
}

export async function cadastrarProduto(produto) {
  const res = await fetch(`${API_BASE}/produtos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(produto),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Erro ao cadastrar produto");
  }
  return res.json();
}

export async function registrarMovimentacao(mov) {
  const res = await fetch(`${API_BASE}/movimentacoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mov),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Erro ao registrar movimentação");
  }
  return res.json();
}
