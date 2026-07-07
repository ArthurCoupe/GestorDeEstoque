const API_BASE = "http://localhost:8000";

async function getErrorMessage(res, fallback) {
  try {
    const err = await res.json();
    return err.detail || fallback;
  } catch {
    return fallback;
  }
}

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
    throw new Error(await getErrorMessage(res, "Erro ao cadastrar produto"));
  }
  return res.json();
}

export async function editarProduto(id, produto) {
  const res = await fetch(`${API_BASE}/produtos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(produto),
  });
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, "Erro ao editar produto"));
  }
  return res.json();
}

export async function excluirProduto(id) {
  const res = await fetch(`${API_BASE}/produtos/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, "Erro ao excluir produto"));
  }
}

export async function listarMovimentacoes() {
  const res = await fetch(`${API_BASE}/movimentacoes`);
  if (!res.ok) throw new Error("Erro ao listar movimentacoes");
  return res.json();
}

export async function registrarMovimentacao(mov) {
  const res = await fetch(`${API_BASE}/movimentacoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mov),
  });
  if (!res.ok) {
    throw new Error(
      await getErrorMessage(res, "Erro ao registrar movimentacao"),
    );
  }
  return res.json();
}
